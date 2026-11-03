import BackgroundTasks
import SwiftUI
import UIKit
import UserNotifications
import WebKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// Native shell for the Swap prototype. The UI is the bundled web app in ../app (same files as the
// web version); this adds what the web can't do on iPhone: real haptics, the system share sheet,
// running fully offline from the app bundle, and Ask Swap answers from Apple's on-device model
// (Apple Intelligence, iOS 26+). Questions and spending data never leave the phone.
@main
struct SwapApp: App {
    @Environment(\.scenePhase) private var phase
    init() { BankWatch.register() }
    var body: some Scene {
        WindowGroup {
            SwapWebView()
                .ignoresSafeArea()
                .background(Color(red: 0.965, green: 0.957, blue: 0.984))
        }
        .onChange(of: phase) { _, now in
            // Open: refresh the morning number (charges count as seen only when the page shows them).
            // Leaving: ask iOS for a background check.
            if now == .active { BankWatch.foreground() }
            if now == .background { BankWatch.schedule() }
        }
    }
}

// Background bank check (only if the private cloud link is set up: app/private/cloud-config.js).
// Every so often, when iOS allows it, Swap wakes up, asks the cloud link for fresh data, posts one
// notification for charges you haven't seen yet ("Corner Cafe $14.20") and re-schedules the morning
// number. No server push or paid developer account needed; iOS decides how often (a few times a day).
//
// Messages from the page, on the existing handler: window.webkit.messageHandlers.notify.postMessage(...)
//   {type: "seen", ids: ["<bank.items[].id>", ...]}  ids the page has actually put on screen. Only these
//                                                    count as seen; opening the app marks nothing by itself.
//   {type: "plan", saveTarget: 100}                  the weekly save target (number). Stored in UserDefaults
//                                                    "swap.saveTarget" (default 100); re-schedules the morning number.
//   {action: "schedule", sunday: true, daily: true}  unchanged API: sunday = Sunday 6 PM "Plan next week",
//                                                    daily = the 8:30 AM morning number ("Today: $X").
//   {action: "cancel"}                               unchanged: turns every reminder off.
// bank.items[].id is stable from pending to posted (sync.py stable_id), so a charge notifies once.
// Pending ride-app holds (hold: true) never notify; the final ride charge does when it posts.
enum BankWatch {
    static let taskID = "swap.bankcheck"
    static let saveKey = "swap.saveTarget"
    private static let seenKey = "swap.seenItems"          // ids the page showed
    private static let notifiedKey = "swap.notifiedItems"  // ids already in a notification
    private static let versionKey = "swap.bankWatchVersion"
    private static let fetchedKey = "swap.lastFetch"
    private static let keep = 600
    private static let lock = NSLock()

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: nil) { task in
            schedule()
            let once = Once()
            let finish: (Bool) -> Void = { ok in once.run { task.setTaskCompleted(success: ok) } }
            let job = check(notify: true, done: finish)
            task.expirationHandler = { job?.cancel(); finish(false) }
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        Notifications.migrate()
    }

    static func schedule() {
        let req = BGAppRefreshTaskRequest(identifier: taskID)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    // On open: the page fetches the bank itself, so the native side only fetches when its own copy is
    // over 2 hours old (otherwise every open would cost two full bank syncs).
    static func foreground() {
        let last = UserDefaults.standard.object(forKey: fetchedKey) as? Date ?? .distantPast
        if Date().timeIntervalSince(last) > 2 * 3600, config() != nil {
            check(notify: false)
        } else {
            Morning.reschedule(live: latest())
        }
    }

    static func markSeen(_ ids: [String]) { remember(ids, key: seenKey) }

    static func setSaveTarget(_ value: Double) {
        UserDefaults.standard.set(value, forKey: saveKey)
        Morning.reschedule(live: latest())
    }

    static var saveTarget: Double { UserDefaults.standard.object(forKey: saveKey) as? Double ?? 100 }

    // url + token from the bundled private config the web app also reads.
    private static func config() -> (URL, String)? {
        guard let f = Bundle.main.url(forResource: "cloud-config", withExtension: "js", subdirectory: "app/private"),
              let text = try? String(contentsOf: f, encoding: .utf8) else { return nil }
        func field(_ name: String) -> String? {
            guard let r = text.range(of: name + #":\s*"([^"]+)""#, options: .regularExpression) else { return nil }
            return text[r].split(separator: "\"").dropFirst().first.map(String.init)
        }
        guard let base = field("url"), let token = field("token"), let url = URL(string: base + "/api/live") else { return nil }
        return (url, token)
    }

    @discardableResult
    static func check(notify: Bool, done: ((Bool) -> Void)? = nil) -> URLSessionDataTask? {
        guard let (url, token) = config() else {
            Morning.reschedule(live: latest())
            done?(false)
            return nil
        }
        var req = URLRequest(url: url, timeoutInterval: 25)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data, let live = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let bank = live["bank"] as? [String: Any], let items = bank["items"] as? [[String: Any]] else {
                done?(false); return
            }
            try? data.write(to: cacheURL, options: .atomic)
            UserDefaults.standard.set(Date(), forKey: fetchedKey)
            if notify {
                let fresh = unseen(items)
                if !fresh.isEmpty { post(fresh, live: live) }
            }
            Morning.reschedule(live: live)
            done?(true)
        }
        task.resume()
        return task
    }

    // Charges not shown on screen and not yet notified. Holds never notify. The first run (and the
    // first run with stable ids) only records what exists, so updating the app sends no burst.
    private static func unseen(_ items: [[String: Any]]) -> [[String: Any]] {
        let d = UserDefaults.standard
        let ids = items.compactMap { $0["id"] as? String }
        if d.integer(forKey: versionKey) < 2 {
            d.set(2, forKey: versionKey)
            remember(ids, key: notifiedKey)
            return []
        }
        let known = Set(d.stringArray(forKey: seenKey) ?? []).union(d.stringArray(forKey: notifiedKey) ?? [])
        let fresh = items.filter { i in
            guard let id = i["id"] as? String, !known.contains(id) else { return false }
            return (i["hold"] as? Bool) != true && ((i["amount"] as? NSNumber)?.doubleValue ?? 0) != 0
        }
        remember(fresh.compactMap { $0["id"] as? String }, key: notifiedKey)
        return fresh
    }

    // Adds ids to a stored list (a union, newest last), keeping the last `keep`.
    private static func remember(_ ids: [String], key: String) {
        guard !ids.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        let d = UserDefaults.standard
        var list = d.stringArray(forKey: key) ?? []
        let have = Set(list)
        list += ids.filter { !have.contains($0) }
        d.set(Array(list.suffix(keep)), forKey: key)
    }

    private static func post(_ items: [[String: Any]], live: [String: Any]) {
        let rideApp = live["rideAppName"] as? String
        func line(_ i: [String: Any]) -> String {
            var name = i["name"] as? String ?? "Charge"
            if let r = rideApp, !r.isEmpty, name == "Lower-fare app" { name = r }
            let a = (i["amount"] as? NSNumber)?.doubleValue ?? 0
            return String(format: a < 0 ? "%@ +$%.2f" : "%@ $%.2f", name, abs(a))
        }
        let content = UNMutableNotificationContent()
        content.title = items.count == 1 ? "New on your bank" : "\(items.count) new on your bank"
        var body = items.prefix(3).map(line).joined(separator: "\n") + (items.count > 3 ? "\nand \(items.count - 3) more" : "")
        if let p = Morning.plan(live: live, on: Date(), saveTarget: saveTarget) {
            body += "\nLeft today " + Morning.money(p.todayLeft)
        }
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "swap.new.\(Date().timeIntervalSince1970)", content: content, trigger: nil))
    }

    // The newest data on the phone: the last cloud fetch, or the bundled app/private/live.js.
    private static var cacheURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("swap-live.json")
    }

    static func latest() -> [String: Any]? {
        let fetched = (try? Data(contentsOf: cacheURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        var bundled: [String: Any]?
        if let f = Bundle.main.url(forResource: "live", withExtension: "js", subdirectory: "app/private"),
           let text = try? String(contentsOf: f, encoding: .utf8),
           let a = text.firstIndex(of: "{"), let b = text.lastIndex(of: "}"), a < b {
            bundled = try? JSONSerialization.jsonObject(with: Data(text[a...b].utf8)) as? [String: Any]
        }
        let stamp = { (l: [String: Any]?) in l?["generatedAt"] as? String ?? "" }
        return stamp(fetched) >= stamp(bundled) ? (fetched ?? bundled) : bundled
    }
}

// Runs a closure once, from whichever thread gets there first (task done vs. expired).
final class Once {
    private var done = false
    private let lock = NSLock()
    func run(_ f: () -> Void) {
        lock.lock(); let first = !done; done = true; lock.unlock()
        if first { f() }
    }
}

// The morning number: one notification at the next 8:30 AM, "Today: $X / Week left $Y. Bank checked 7:31 AM."
// A small port of the page's daily plan (app/core.js dailyPlan) on flexible spending only:
//   budget = bank.flex.usual - save target; weights = bank.flex.dayWeights (Mon..Sun);
//   spent per day = this week's bank.items (week "now") with amount > 0 that are not fixed or Investing;
//   days before the target day keep their original plan (budget x weight); what's left after what was
//   actually spent is spread over that day and the rest of the week by weight, each day at least
//   half its original plan. When the data is from another week it says "Open Swap to refresh".
enum Morning {
    static let id = "swap.morning"
    static let onKey = "swap.morningOn"
    struct Plan { let today: Double; let todayLeft: Double; let weekLeft: Double; let budget: Double }

    static func nextFire(after now: Date = Date()) -> Date {
        let cal = Calendar.current
        var c = cal.dateComponents([.year, .month, .day], from: now)
        c.hour = 8; c.minute = 30
        let today = cal.date(from: c) ?? now
        return now < today ? today : (cal.date(byAdding: .day, value: 1, to: today) ?? today)
    }

    static func plan(live: [String: Any], on day: Date, saveTarget: Double) -> Plan? {
        guard let bank = live["bank"] as? [String: Any], let flex = bank["flex"] as? [String: Any],
              let usual = (flex["usual"] as? NSNumber)?.doubleValue,
              let w = (flex["dayWeights"] as? [NSNumber])?.map(\.doubleValue), w.count == 7,
              let items = bank["items"] as? [[String: Any]],
              let ws = (live["current"] as? [String: Any])?["weekStart"] as? String,
              let start = localDay(ws) else { return nil }
        let cal = Calendar.current
        guard let t = cal.dateComponents([.day], from: start, to: cal.startOfDay(for: day)).day, (0...6).contains(t) else { return nil }
        let budget = max(0, usual - saveTarget)
        var spent = [Double](repeating: 0, count: 7)
        for i in items where (i["week"] as? String) == "now" && (i["fixed"] as? Bool) != true && (i["cat"] as? String) != "Investing" {
            let a = (i["amount"] as? NSNumber)?.doubleValue ?? 0
            guard a > 0, let d = (i["day"] as? NSNumber)?.intValue, (0..<7).contains(d) else { continue }
            spent[d] += a
        }
        let before = spent[0..<t].reduce(0, +)
        let left = max(0, budget - before)
        let rest = w[t...].reduce(0, +)
        let original = budget * w[t]
        let today = max(original * 0.5, left * w[t] / (rest > 0 ? rest : 1))
        return Plan(today: today, todayLeft: today - spent[t], weekLeft: budget - spent.reduce(0, +), budget: budget)
    }

    static func reschedule(live: [String: Any]?) {
        let center = UNUserNotificationCenter.current()
        guard UserDefaults.standard.bool(forKey: onKey) else {
            center.removePendingNotificationRequests(withIdentifiers: [id]); return
        }
        let fire = nextFire()
        let content = UNMutableNotificationContent()
        if let live, let p = plan(live: live, on: fire, saveTarget: BankWatch.saveTarget) {
            content.title = "Today: " + money(p.today)
            content.body = "Week left \(money(p.weekLeft))." + (checked(live).map { " Bank checked \($0)." } ?? "")
        } else {
            content.title = "Today"
            content.body = "Open Swap to refresh."
        }
        content.sound = .default
        let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))   // same id replaces it
    }

    static func money(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal; f.maximumFractionDigits = 0
        let s = f.string(from: NSNumber(value: abs(v).rounded())) ?? String(Int(abs(v).rounded()))
        return (v < -0.5 ? "-$" : "$") + s
    }

    // "2026-11-02" as the start of that day, on this phone's calendar.
    private static func localDay(_ s: String) -> Date? {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    // When the bank was last checked (bankCheckedAt, New York time): "7:31 AM", or "Mon 7:31 AM" if not today.
    private static func checked(_ live: [String: Any]) -> String? {
        guard let s = (live["bankCheckedAt"] as? String) ?? (live["generatedAt"] as? String) else { return nil }
        let inF = DateFormatter()
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.timeZone = TimeZone(identifier: "America/New_York")
        inF.dateFormat = "yyyy-MM-dd'T'HH:mm"
        guard let d = inF.date(from: String(s.prefix(16))) else { return nil }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = Calendar.current.isDateInToday(d) ? "h:mm a" : "EEE h:mm a"
        return out.string(from: d)
    }
}

struct SwapWebView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // keeps localStorage between launches
        config.userContentController.add(context.coordinator, name: "haptic")
        config.userContentController.add(context.coordinator, name: "share")
        config.userContentController.add(context.coordinator, name: "notify")
        config.userContentController.add(context.coordinator, name: "ask")
        // Tell the page, before any script runs, whether the on-device model can answer.
        config.userContentController.addUserScript(WKUserScript(
            source: "window.SwapNative = Object.assign(window.SwapNative || {}, { ai: \(Bridge.jsString(AskSwap.status())) });",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.965, green: 0.957, blue: 0.984, alpha: 1)
        // The web app scrolls its own views; the page itself never scrolls or zooms.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true } // Safari > Develop for debugging
        context.coordinator.web = web

        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "app") {
            web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    // Receives window.webkit.messageHandlers.<name>.postMessage(...) from core.js.
    final class Bridge: NSObject, WKScriptMessageHandler {
        weak var web: WKWebView?
        private let selection = UISelectionFeedbackGenerator()
        private let impact = UIImpactFeedbackGenerator(style: .medium)
        private let notify = UINotificationFeedbackGenerator()
        private let ask = AskSwap()

        override init() {
            super.init()
            // Apple Intelligence can be turned on, or finish downloading, while the app is in the background.
            NotificationCenter.default.addObserver(self, selector: #selector(refreshStatus),
                                                   name: UIApplication.didBecomeActiveNotification, object: nil)
        }

        @objc private func refreshStatus() {
            web?.evaluateJavaScript("window.SwapAI && window.SwapAI._status(\(Bridge.jsString(AskSwap.status())))", completionHandler: nil)
        }

        // A Swift string as a JS string literal (JSON-escaped).
        static func jsString(_ s: String) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: [s]),
                  let json = String(data: data, encoding: .utf8) else { return "\"\"" }
            return String(json.dropFirst().dropLast())
        }

        // Calls window.SwapAI.<fn>(id, text) in the page.
        func callJS(_ fn: String, _ id: String, _ text: String) {
            web?.evaluateJavaScript("window.SwapAI && window.SwapAI.\(fn)(\(Bridge.jsString(id)), \(Bridge.jsString(text)))", completionHandler: nil)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "haptic":
                switch message.body as? String ?? "light" {
                case "success": notify.notificationOccurred(.success)
                case "heavy": impact.impactOccurred()
                default: selection.selectionChanged()
                }
            case "share":
                guard let body = message.body as? [String: Any], let web else { return }
                var items: [Any] = []
                if let dataURL = body["image"] as? String,
                   let comma = dataURL.firstIndex(of: ","),
                   let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
                   let image = UIImage(data: data) {
                    items.append(image)
                }
                if let text = body["text"] as? String, !text.isEmpty { items.append(text) }
                guard !items.isEmpty, let root = web.window?.rootViewController else { return }
                let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = web
                root.present(sheet, animated: true)
            case "notify":
                // Message shapes: see the comment at the top of BankWatch.
                guard let body = message.body as? [String: Any] else { return }
                switch body["type"] as? String {
                case "seen":
                    BankWatch.markSeen((body["ids"] as? [Any] ?? []).compactMap { $0 as? String }); return
                case "plan":
                    if let n = (body["saveTarget"] as? NSNumber)?.doubleValue { BankWatch.setSaveTarget(n) }
                    return
                default: break
                }
                if (body["action"] as? String) == "cancel" { Notifications.cancelAll(); return }
                Notifications.schedule(sunday: body["sunday"] as? Bool ?? true, daily: body["daily"] as? Bool ?? false)
            case "ask":
                guard let body = message.body as? [String: Any] else { return }
                let context = body["context"] as? String ?? ""
                let rideApp = body["rideApp"] as? Bool ?? false
                // The ride app's name only comes from the private data (RIDE_APP_NAME in .env), never from code.
                let rideName = (body["rideAppName"] as? String) ?? (BankWatch.latest()?["rideAppName"] as? String)
                if (body["type"] as? String) == "prewarm" { ask.prewarm(context: context, rideApp: rideApp, rideName: rideName); return }
                guard let id = body["id"] as? String, let question = body["question"] as? String else { return }
                ask.answer(question: question, context: context, rideApp: rideApp, rideName: rideName,
                           partial: { [weak self] text in self?.callJS("_partial", id, text) },
                           done: { [weak self] result in
                               switch result {
                               case .success(let text): self?.callJS("_resolve", id, text)
                               case .failure(let error): self?.callJS("_reject", id, String(describing: error))
                               }
                           })
            default:
                break
            }
        }
    }
}

// Ask Swap: Apple's on-device language model, grounded in the context the page sends (sections for this week, today, the daily plan,
// last week, the usual week, the last 10 weeks, the whole bank, prices, memberships). One fresh session per
// question so answers never drift from the numbers on screen. Falls back (reject) when unavailable;
// the page then uses its scripted answers.
final class AskSwap {
    struct Unavailable: Error, CustomStringConvertible { let description: String }

    static func status() -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return "available"
            case .unavailable(.deviceNotEligible): return "deviceNotEligible"
            case .unavailable(.appleIntelligenceNotEnabled): return "appleIntelligenceNotEnabled"
            case .unavailable(.modelNotReady): return "modelNotReady"
            case .unavailable(let other): return "unavailable: \(other)"
            }
        }
        #endif
        return "unsupportedOS"
    }

    // rideApp is true only when the page allows suggesting the lower-fare ride app (RECOMMEND_RIDE_APP
    // in the private build). Its name comes from the private data (rideName); otherwise it stays generic.
    static func instructions(rideApp: Bool, rideName: String?) -> String {
        let named = (rideName?.isEmpty == false) ? rideName! : nil
        let rideRule = rideApp
            ? "- \(named ?? "The lower-fare ride app") is your cheaper ride app. When you ask for a cheaper ride, suggest it over Uber or Lyft, using the ride prices in DATA. That is fine at night too."
            : "- Never suggest \(named.map { $0 + ", " } ?? "")the lower-fare app, or switching ride apps as a way to save."
        return base + "\n" + rideRule + "\n" + tail
    }

    private static let base = """
    You are Swap, a calm spending coach in a college student's money app. Answer the student's \
    question about their own money using only the facts in DATA. Each DATA line is one fact.

    DATA has sections, each marked with "##": THIS WEEK (Monday to today), TODAY, DAILY PLAN (this week), \
    LAST WEEK (the finished week before), USUAL WEEK, WHERE YOUR MONEY GOES or LAST 10 WEEKS, WHOLE BANK, OTHER. \
    Every line names its own week. Never use a LAST WEEK number for a THIS WEEK question, or the other way around.

    Rules:
    - Answer the exact question first, in 1 or 2 short sentences, with the number. Nothing before the answer.
    - Which week: questions in the present tense ("my cap", "my budget", "how much can I spend", "how am I doing", \
    "what did I spend", "so far", "now") are about THIS WEEK or TODAY. Use LAST WEEK only when the question says "last week". \
    The question's "Week asked about" line tells you which section to answer from.
    - "Budget this week" is the weekly budget for all spending. "Cap" is the food and getting around cap; \
    use it only when the question is about food, rides, or last week.
    - When the student asks for one number (cap, budget, left, today, spent), give that number and its label, and stop. \
    Do not compare with the usual week, last week, or anything else unless the student asks for a comparison.
    - If the student corrects you ("no, this week", "I meant last week"), answer the earlier question again for the week they named.
    - When the question comes with relevant facts, answer from those facts first.
    - Be terse: name the thing, then its dollar amount. Use the exact label and amount from the DATA line you are using. \
    The categories are Eating out, Alcohol & bodega, Coffee & snacks, Delivery, Rides, and Subway. Food and Getting around are groups; \
    never call the Getting around total "rides".
    - Never add, subtract, or estimate. Only use numbers written in DATA.
    - Plain words. Say "you". No greeting, no filler, no exclamation marks, no emoji, no dashes, no lists.
    - Never judge, and never tell the student what they cannot do. Never say "over budget". Compare only with the student's own usual week, never with other people.
    - Say "left" for money left under the budget or cap.
    - If DATA says last week's spending is hidden until the student guesses, do not give last week's total; say to guess the week first. This week is never hidden.
    - For "most unnecessary" or "what can I cut", name the biggest cuttable categories from DATA with their weekly amounts, and add "Night rides are always OK."
    - Suggest something only when the student asks how to save or for a cheaper way, and then only one thing from DATA. Otherwise suggest nothing.
    - Night rides (11 PM to 6 AM) count as spending but are always OK. Never suggest skipping a ride, walking, or the subway between 11 PM and 6 AM. \
    If asked whether to skip a late-night ride to save money, say: "Don't skip it. Night rides are always OK."
    """

    private static let tail = """
    - If DATA has nothing on the question, say you can only see your card spending, then name one thing you can answer.
    """

    #if canImport(FoundationModels)
    private var warmed: (key: String, session: AnyObject)?
    #endif

    func prewarm(context: String, rideApp: Bool, rideName: String?) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability, !context.isEmpty else { return }
            let key = (rideApp ? "1" : "0") + (rideName ?? "") + "|" + context
            if let warmed, warmed.key == key { return }
            let session = LanguageModelSession(instructions: Self.instructions(rideApp: rideApp, rideName: rideName) + "\n\nDATA\n" + context)
            session.prewarm()
            warmed = (key, session)
        }
        #endif
    }

    func answer(question: String, context: String, rideApp: Bool, rideName: String?, partial: @escaping (String) -> Void, done: @escaping (Result<String, Error>) -> Void) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                done(.failure(Unavailable(description: Self.status()))); return
            }
            // A prewarmed session for the same data is used once, then dropped (no carry-over).
            let session: LanguageModelSession
            let key = (rideApp ? "1" : "0") + (rideName ?? "") + "|" + context
            if let warmed, warmed.key == key, let s = warmed.session as? LanguageModelSession, !s.isResponding, s.transcript.count <= 1 {
                session = s
            } else {
                session = LanguageModelSession(instructions: Self.instructions(rideApp: rideApp, rideName: rideName) + "\n\nDATA\n" + context)
            }
            warmed = nil
            let options = GenerationOptions(temperature: 0.2, maximumResponseTokens: 160)
            Task { @MainActor in
                do {
                    var text = ""
                    var lastSent = Date.distantPast
                    for try await snapshot in session.streamResponse(to: question, options: options) {
                        text = snapshot.content
                        if Date().timeIntervalSince(lastSent) > 0.06 { partial(text); lastSent = Date() }
                    }
                    done(.success(text))
                } catch {
                    done(.failure(error))
                }
            }
            return
        }
        #endif
        done(.failure(Unavailable(description: "unsupportedOS")))
    }
}

// Local notifications: scheduled on the phone, no server or account needed.
// sunday: Sunday 6 PM "Plan next week". daily: the 8:30 AM morning number (Morning, one request
// re-scheduled after every bank check, since a repeating notification can't carry a live number).
enum Notifications {
    static func schedule(sunday: Bool, daily: Bool) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            center.removePendingNotificationRequests(withIdentifiers: ["swap.sunday", "swap.daily"])
            UserDefaults.standard.set(daily, forKey: Morning.onKey)
            if sunday { addSunday() }
            Morning.reschedule(live: BankWatch.latest())
        }
    }

    static func cancelAll() {
        UserDefaults.standard.set(false, forKey: Morning.onKey)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["swap.sunday", "swap.daily", Morning.id])
    }

    // Older builds scheduled a noon "Tag yesterday" reminder and a Sunday "Your week is ready" one.
    // Turn them into the morning number and the Sunday plan, keeping his on/off choices.
    static func migrate() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { reqs in
            let ids = Set(reqs.map(\.identifier))
            if ids.contains("swap.daily") {
                center.removePendingNotificationRequests(withIdentifiers: ["swap.daily"])
                UserDefaults.standard.set(true, forKey: Morning.onKey)
            }
            if let old = reqs.first(where: { $0.identifier == "swap.sunday" }), old.content.title != sundayTitle { addSunday() }
            Morning.reschedule(live: BankWatch.latest())
        }
    }

    private static let sundayTitle = "Plan next week"

    private static func addSunday() {
        var when = DateComponents(); when.weekday = 1; when.hour = 18 // Sunday 6 pm
        add(id: "swap.sunday", title: sundayTitle, body: "Pick your swaps for the week.", when: when)
    }

    private static func add(id: String, title: String, body: String, when: DateComponents) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
}
