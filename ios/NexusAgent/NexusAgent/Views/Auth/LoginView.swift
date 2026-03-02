import SwiftUI

/// Login screen with automatic server discovery and manual fallback.
/// Flow: Discover → (found) → Login  |  (failed) → Manual Entry → Login
struct LoginView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var discovery = ServerDiscovery()

    @State private var email = ""
    @State private var password = ""
    @State private var showManualEntry = false

    /// Whether discovery has been attempted at least once.
    @State private var hasAttemptedDiscovery = false

    /// Whether the server is confirmed (either discovered or manually entered).
    @State private var serverConfirmed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()

                // Logo & Title
                VStack(spacing: 12) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 60))
                        .foregroundStyle(.tint)

                    Text("Nexus Agent")
                        .font(.largeTitle.bold())

                    Text("AI Assistant Platform")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.bottom, 40)

                // Content switches between discovery and login
                VStack(spacing: 16) {
                    if !serverConfirmed {
                        // ── Server Discovery Phase ──
                        serverDiscoverySection
                    } else {
                        // ── Login Phase ──
                        loginSection
                    }
                }
                .padding(.horizontal, 32)

                Spacer()
                Spacer()
            }
            .animation(.easeInOut(duration: 0.3), value: serverConfirmed)
            .animation(.easeInOut(duration: 0.3), value: showManualEntry)
            .animation(.easeInOut(duration: 0.2), value: discovery.state)
            .onAppear {
                if let saved = AuthService.shared.savedEmail {
                    email = saved
                }
                // Auto-start discovery
                if !hasAttemptedDiscovery {
                    hasAttemptedDiscovery = true
                    Task { await discovery.discover(savedURL: authVM.serverURL.isEmpty ? nil : authVM.serverURL) }
                }
            }
            .onChange(of: discovery.state) { _, newState in
                if case .found(let url) = newState {
                    authVM.serverURL = url
                    authVM.setServerURL(url)
                    withAnimation { serverConfirmed = true }
                }
            }
        }
    }

    // MARK: - Server Discovery Section

    @ViewBuilder
    private var serverDiscoverySection: some View {
        switch discovery.state {
        case .idle, .scanning:
            // Scanning animation
            VStack(spacing: 16) {
                // Radar animation
                ZStack {
                    Circle()
                        .stroke(.tint.opacity(0.1), lineWidth: 2)
                        .frame(width: 100, height: 100)
                    Circle()
                        .stroke(.tint.opacity(0.2), lineWidth: 2)
                        .frame(width: 70, height: 70)
                    Circle()
                        .stroke(.tint.opacity(0.3), lineWidth: 2)
                        .frame(width: 40, height: 40)
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.title2)
                        .foregroundStyle(.tint)
                        .symbolEffect(.variableColor.iterative, options: .repeating)
                }

                if case .scanning(let progress, let detail) = discovery.state {
                    Text("Discovering Server...")
                        .font(.headline)

                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .tint(.accentColor)

                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Looking for Nexus Agent...")
                        .font(.headline)
                    ProgressView()
                }

                // Manual entry bypass
                Button {
                    discovery.cancel()
                    withAnimation { showManualEntry = true }
                } label: {
                    Text("Enter address manually")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 8)
            }
            .transition(.opacity.combined(with: .scale(scale: 0.95)))

        case .found:
            // Briefly shown before auto-transitioning to login
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.green)

                Text("Server Found!")
                    .font(.headline)

                Text(authVM.serverURL)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            .transition(.opacity.combined(with: .scale(scale: 0.95)))

        case .failed:
            // Discovery failed — show manual entry
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 40))
                    .foregroundStyle(.orange)

                Text("Server Not Found")
                    .font(.headline)

                Text("Could not discover a Nexus Agent server on your network.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                manualEntryFields

                HStack(spacing: 12) {
                    // Retry discovery
                    Button {
                        withAnimation { showManualEntry = false }
                        Task { await discovery.discover(savedURL: nil) }
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)

                    // Connect with manual URL
                    Button {
                        authVM.setServerURL(authVM.serverURL)
                        Task {
                            // Quick probe to verify
                            let probeDiscovery = ServerDiscovery()
                            await probeDiscovery.discover(savedURL: authVM.serverURL)
                            if case .found = probeDiscovery.state {
                                withAnimation { serverConfirmed = true }
                            } else {
                                authVM.error = "Cannot connect to \(authVM.serverURL)"
                            }
                        }
                    } label: {
                        Text("Connect")
                            .font(.subheadline)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(authVM.serverURL.isEmpty)
                }
            }
            .transition(.opacity.combined(with: .scale(scale: 0.95)))
        }

        // Inline manual entry if user tapped "Enter address manually" during scan
        if showManualEntry && discovery.state != .failed {
            VStack(spacing: 12) {
                Divider()
                    .padding(.vertical, 4)

                manualEntryFields

                if let error = authVM.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Button {
                    authVM.setServerURL(authVM.serverURL)
                    Task {
                        let probeDiscovery = ServerDiscovery()
                        await probeDiscovery.discover(savedURL: authVM.serverURL)
                        if case .found = probeDiscovery.state {
                            withAnimation { serverConfirmed = true }
                        } else {
                            authVM.error = "Cannot connect to \(authVM.serverURL)"
                        }
                    }
                } label: {
                    Text("Connect")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(authVM.serverURL.isEmpty)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // MARK: - Manual Entry Fields

    private var manualEntryFields: some View {
        HStack {
            Image(systemName: "server.rack")
                .foregroundStyle(.secondary)
            TextField("http://YOUR_SERVER_IP:3000", text: $authVM.serverURL)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .autocorrectionDisabled()
        }
        .padding(12)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Login Section

    private var loginSection: some View {
        VStack(spacing: 16) {
            // Connected server indicator
            Button {
                // Tap to go back to discovery
                withAnimation {
                    serverConfirmed = false
                    showManualEntry = false
                    discovery.state = .idle
                }
                Task { await discovery.discover(savedURL: authVM.serverURL.isEmpty ? nil : authVM.serverURL) }
            } label: {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text(authVM.serverURL)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text("Change")
                        .font(.caption2)
                        .foregroundStyle(.accentColor)
                }
                .padding(10)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Email
            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .autocorrectionDisabled()

            // Password
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)

            // Error message
            if let error = authVM.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Login Button
            Button {
                Task { await authVM.login(email: email, password: password) }
            } label: {
                if authVM.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                } else {
                    Text("Sign In")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(email.isEmpty || password.isEmpty || authVM.isLoading)
        }
        .transition(.opacity.combined(with: .move(edge: .trailing)))
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthViewModel())
}
