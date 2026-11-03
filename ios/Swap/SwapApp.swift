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
            // Open: what's on screen counts as seen. Leaving: ask iOS for a background check.
            if now == .active { BankWatch.check(notify: false) }
            if now == .background { BankWatch.schedule() }
        }
    }
}

// Background bank check (only if the private cloud link is set up: app/private/cloud-config.js).
// Every so often, when iOS allows it, Swap wakes up, asks the cloud link for fresh data and posts
// a notification for charges you haven't seen yet ("Corner Cafe $14.20"). No server push or
// paid developer account needed; iOS decides how often (usually a few times a day).
enum BankWatch {
    static let taskID = "swap.bankcheck"
    private static let seenKey = "swap.seenItems"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: nil) { task in
            schedule()
            task.expirationHandler = { task.setTaskCompleted(success: false) }
            check(notify: true) { ok in task.setTaskCompleted(success: ok) }
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func schedule() {
        let req = BGAppRefreshTaskRequest(identifier: taskID)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

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

    static func check(notify: Bool, done: ((Bool) -> Void)? = nil) {
        guard let (url, token) = config() else { done?(false); return }
        var req = URLRequest(url: url, timeoutInterval: 25)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data, let live = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let bank = live["bank"] as? [String: Any], let items = bank["items"] as? [[String: Any]] else { done?(false); return }
            let ids = items.compactMap { $0["id"] as? String }
            let defaults = UserDefaults.standard
            let seen = Set(defaults.stringArray(forKey: seenKey) ?? [])
            defaults.set(ids, forKey: seenKey)
            // First run only records what exists; after that, anything unseen is new.
            guard notify, !seen.isEmpty else { done?(true); return }
            let fresh = items.filter { ($0["id"] as? String).map { !seen.contains($0) } ?? false }
            if !fresh.isEmpty { post(fresh, rideApp: live["rideAppName"] as? String) }
            done?(true)
        }.resume()
    }

    private static func post(_ items: [[String: Any]], rideApp: String?) {
        func line(_ i: [String: Any]) -> String {
            var name = i["name"] as? String ?? "Charge"
            if let r = rideApp, name == "Lower-fare app" { name = r }
            let a = i["amount"] as? Double ?? 0
            return String(format: a < 0 ? "%@ +$%.2f" : "%@ $%.2f", name, abs(a))
        }
        let content = UNMutableNotificationContent()
        content.title = items.count == 1 ? "New on your bank" : "\(items.count) new on your bank"
        content.body = items.prefix(3).map(line).joined(separator: "\n") + (items.count > 3 ? "\nand \(items.count - 3) more" : "")
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "swap.new.\(Date().timeIntervalSince1970)", content: content, trigger: nil))
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
                guard let body = message.body as? [String: Any] else { return }
                if (body["action"] as? String) == "cancel" { Notifications.cancelAll(); return }
                Notifications.schedule(sunday: body["sunday"] as? Bool ?? true, daily: body["daily"] as? Bool ?? false)
            case "ask":
                guard let body = message.body as? [String: Any] else { return }
                let context = body["context"] as? String ?? ""
                let rideApp = body["rideApp"] as? Bool ?? false
                if (body["type"] as? String) == "prewarm" { ask.prewarm(context: context, rideApp: rideApp); return }
                guard let id = body["id"] as? String, let question = body["question"] as? String else { return }
                ask.answer(question: question, context: context, rideApp: rideApp,
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

    // rideApp is true only when the page allows suggesting the ride app (Lower-fare app): the founder's
    // build, and only while he doesn't already take it for almost every ride. Otherwise never suggested.
    static func instructions(rideApp: Bool) -> String {
        let rideRule = rideApp
            ? "- Lower-fare app is your cheaper ride app. When you ask for a cheaper ride, suggest Lower-fare app over Uber or Lyft, using the ride prices in DATA. That is fine at night too."
            : "- Never suggest Lower-fare app, the lower-fare app, or switching ride apps as a way to save."
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

    func prewarm(context: String, rideApp: Bool) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability, !context.isEmpty else { return }
            let key = (rideApp ? "1" : "0") + context
            if let warmed, warmed.key == key { return }
            let session = LanguageModelSession(instructions: Self.instructions(rideApp: rideApp) + "\n\nDATA\n" + context)
            session.prewarm()
            warmed = (key, session)
        }
        #endif
    }

    func answer(question: String, context: String, rideApp: Bool, partial: @escaping (String) -> Void, done: @escaping (Result<String, Error>) -> Void) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                done(.failure(Unavailable(description: Self.status()))); return
            }
            // A prewarmed session for the same data is used once, then dropped (no carry-over).
            let session: LanguageModelSession
            let key = (rideApp ? "1" : "0") + context
            if let warmed, warmed.key == key, let s = warmed.session as? LanguageModelSession, !s.isResponding, s.transcript.count <= 1 {
                session = s
            } else {
                session = LanguageModelSession(instructions: Self.instructions(rideApp: rideApp) + "\n\nDATA\n" + context)
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
enum Notifications {
    static func schedule(sunday: Bool, daily: Bool) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            center.removeAllPendingNotificationRequests()
            if sunday {
                var when = DateComponents(); when.weekday = 1; when.hour = 18 // Sunday 6 pm
                add(id: "swap.sunday", title: "Your week is ready", body: "Guess it before you see it.", when: when)
            }
            if daily {
                var when = DateComponents(); when.hour = 12 // noon
                add(id: "swap.daily", title: "Tag yesterday", body: "One word per charge. Skip any.", when: when)
            }
        }
    }

    static func cancelAll() { UNUserNotificationCenter.current().removeAllPendingNotificationRequests() }

    private static func add(id: String, title: String, body: String, when: DateComponents) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
}
