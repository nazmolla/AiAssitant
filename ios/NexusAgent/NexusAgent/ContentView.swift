import SwiftUI

/// Root content view with tab navigation.
/// Shows LoginView when unauthenticated, tab bar when authenticated.
struct ContentView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var chatVM = ChatViewModel()

    var body: some View {
        Group {
            if authVM.isLoading {
                // Splash / loading
                VStack(spacing: 16) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 50))
                        .foregroundStyle(.tint)
                    ProgressView("Connecting...")
                }
            } else if authVM.isAuthenticated {
                // Main app
                TabView {
                    // Chat tab
                    NavigationSplitView {
                        ThreadListView()
                    } detail: {
                        ChatView()
                    }
                    .tabItem {
                        Label("Chat", systemImage: "message.fill")
                    }
                    .environmentObject(chatVM)

                    // Knowledge tab
                    KnowledgeListView()
                        .tabItem {
                            Label("Knowledge", systemImage: "brain")
                        }

                    // Approvals tab
                    ApprovalsView()
                        .tabItem {
                            Label("Approvals", systemImage: "checkmark.shield")
                        }

                    // Settings tab
                    SettingsView()
                        .tabItem {
                            Label("Settings", systemImage: "gear")
                        }

                    // Profile tab
                    ProfileView()
                        .toolbar {
                            ToolbarItem(placement: .destructiveAction) {
                                Button("Sign Out") {
                                    Task { await authVM.logout() }
                                }
                            }
                        }
                        .tabItem {
                            Label("Profile", systemImage: "person.circle")
                        }
                }
                .task {
                    await chatVM.loadThreads()
                }
            } else {
                // Login
                LoginView()
            }
        }
        .task {
            await authVM.checkSession()
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthViewModel())
}
