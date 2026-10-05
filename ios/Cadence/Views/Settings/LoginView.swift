import SwiftUI

struct LoginView: View {
    @Environment(Session.self) private var session
    @State private var server = UserDefaults.standard.string(forKey: "lastServer") ?? ""
    @State private var username = UserDefaults.standard.string(forKey: "lastUser") ?? ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Field { case server, username, password }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.98, green: 0.18, blue: 0.28).opacity(0.55), Color(red: 0.37, green: 0.36, blue: 0.9).opacity(0.45), Color(.systemBackground)],
                startPoint: .topLeading, endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 22) {
                    appIcon
                        .padding(.top, 60)
                    VStack(spacing: 6) {
                        Text("Sign in to Navidrome").font(.title.bold())
                        Text("Connect Cadence to your music server.")
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 12) {
                        field("Server", text: $server, prompt: "https://music.example.com", field: .server)
                            .keyboardType(.URL)
                        field("Username", text: $username, prompt: "Username", field: .username)
                            .textContentType(.username)
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { Task { await signIn() } }
                            .padding(14)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }

                    Button {
                        Task { await signIn() }
                    } label: {
                        Group {
                            if busy { ProgressView().tint(.white) } else { Text("Sign In") }
                        }
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.accentColor))
                    }
                    .disabled(busy || server.isEmpty || username.isEmpty)

                    Text("Your password is never stored — only a salted token, like other Subsonic clients.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 28)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear { focus = server.isEmpty ? .server : .password }
    }

    private var appIcon: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(LinearGradient(colors: [Color(red: 1, green: 0.42, blue: 0.44), Color(red: 0.98, green: 0.18, blue: 0.28), Color(red: 0.78, green: 0.09, blue: 0.37)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: 96, height: 96)
            .overlay(Image(systemName: "waveform").font(.system(size: 44, weight: .bold)).foregroundStyle(.white))
            .shadow(color: Color.accentColor.opacity(0.4), radius: 16, y: 8)
    }

    private func field(_ title: String, text: Binding<String>, prompt: String, field: Field) -> some View {
        TextField(title, text: text, prompt: Text(prompt))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: field)
            .submitLabel(.next)
            .onSubmit { focus = field == .server ? .username : .password }
            .padding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func signIn() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let (client, info) = try await SubsonicClient.signIn(server: server, username: username, password: password)
            session.signIn(client: client, info: info)
        } catch let e as SubsonicError where e.code == 40 {
            error = "Wrong username or password."
        } catch let e {
            error = e.localizedDescription
        }
    }
}
