import SwiftUI

struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false
    @State private var testing = false
    @State private var testResult: MotionService.TestResult?

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section("Account") {
                LabeledContent("Server", value: session.api?.creds.server.host() ?? "—")
                LabeledContent("Signed in as", value: session.api?.creds.username ?? "—")
                if let type = session.serverType {
                    LabeledContent("Server version", value: "\(type) \(session.serverVersion ?? "")")
                }
                LabeledContent("Synced lyrics", value: session.supportsSyncedLyrics ? "Supported" : "Basic")
                Button("Sign Out", role: .destructive) { confirmSignOut = true }
            }

            Section {
                Picker("Wi-Fi Streaming", selection: $settings.wifiQuality) {
                    ForEach(StreamQuality.allCases) { Text($0.title).tag($0) }
                }
                Picker("Cellular Streaming", selection: $settings.cellularQuality) {
                    ForEach(StreamQuality.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Sound Check", isOn: $settings.soundCheck)
                Toggle("Autoplay", isOn: $settings.autoplay)
                Toggle("Scrobble Plays", isOn: $settings.scrobble)
            } header: {
                Text("Playback")
            } footer: {
                Text("Transcoding happens on your Navidrome server. Sound Check evens out loudness using ReplayGain tags. Scrobbles update play counts and are forwarded to Last.fm or ListenBrainz if Navidrome is set up for them.")
            }

            DownloadSettingsSection()

            Section {
                Toggle("Find Lyrics on LRCLIB", isOn: $settings.lrclib)
            } header: {
                Text("Lyrics")
            } footer: {
                Text("Uses lrclib.net for synced lyrics when Navidrome has none.")
            }

            Section {
                Picker("Artwork Quality", selection: $settings.artworkQuality) {
                    ForEach(ArtworkQuality.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Artwork")
            } footer: {
                Text(artworkFooter)
            }

            motionSection

            Section("About") {
                LabeledContent("Version", value: appVersion)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .confirmationDialog("Sign out of \(session.api?.creds.server.host() ?? "your server")?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                PlayerModel.shared.reset()
                session.signOut()
                dismiss()
            }
        }
    }

    private var motionSection: some View {
        @Bindable var settings = settings
        return Section {
            Toggle("Animated Artwork", isOn: $settings.motionEnabled)
            if settings.motionEnabled {
                Toggle("Get Token from music.apple.com", isOn: $settings.motionAutoToken)
                if !settings.motionAutoToken {
                    TextField("Developer token", text: $settings.motionToken)
                        .font(.footnote.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                LabeledContent("Storefront") {
                    TextField("us", text: $settings.storefront)
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .frame(width: 60)
                }
                Button {
                    Task { await test() }
                } label: {
                    HStack {
                        Text("Test")
                        Spacer()
                        if testing { ProgressView() }
                    }
                }
                .disabled(testing)
                if let testResult {
                    Text(testResult.message)
                        .font(.footnote)
                        .foregroundStyle(testResult.ok ? Color.green : Color.orange)
                }
                Button("Clear Animated Artwork Cache") {
                    Task { await MotionService.shared.clearCache() }
                    Toast.shared.show("Cache cleared")
                }
            }
        } header: {
            Text("Animated Artwork")
        } footer: {
            Text("Plays Apple Music's animated album covers on album pages and in the player. Uses the token built into Apple's web player, fetched again automatically when it expires. This isn't an officially supported use of that token, so it may stop working if Apple changes their site.")
        }
    }

    private var artworkFooter: String {
        switch settings.artworkQuality {
        case .standard: "Covers load at their on-screen size (least data)."
        case .high: "Covers load at twice their on-screen size so they stay sharp."
        case .original: "Full-resolution covers on album pages and in the player; sharp copies elsewhere."
        }
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    private func test() async {
        testing = true
        testResult = nil
        let config = MotionService.Config(autoToken: settings.motionAutoToken, token: settings.motionToken, storefront: settings.storefront)
        testResult = await MotionService.shared.test(config: config)
        testing = false
    }
}
