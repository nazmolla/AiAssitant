import SwiftUI

/// User profile editing view with all profile fields and password change.
struct ProfileView: View {
    @StateObject private var vm = ProfileViewModel()
    @State private var showPasswordSheet = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Personal Info") {
                    TextField("Display Name", text: $vm.profile.display_name)
                    TextField("Title", text: $vm.profile.title)
                    TextField("Company", text: $vm.profile.company)
                    TextField("Location", text: $vm.profile.location)
                    TextField("Bio", text: $vm.profile.bio, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Contact") {
                    TextField("Email", text: $vm.profile.email)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                    TextField("Phone", text: $vm.profile.phone)
                        .keyboardType(.phonePad)
                    TextField("Website", text: $vm.profile.website)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }

                Section("Social") {
                    TextField("LinkedIn", text: $vm.profile.linkedin)
                        .autocapitalization(.none)
                    TextField("GitHub", text: $vm.profile.github)
                        .autocapitalization(.none)
                    TextField("Twitter / X", text: $vm.profile.twitter)
                        .autocapitalization(.none)
                }

                Section("Preferences") {
                    Picker("Theme", selection: $vm.profile.theme) {
                        Text("Ember").tag("ember")
                        Text("Ocean").tag("ocean")
                        Text("Forest").tag("forest")
                        Text("Midnight").tag("midnight")
                    }

                    Picker("Font", selection: $vm.profile.font) {
                        Text("Inter").tag("inter")
                        Text("Roboto").tag("roboto")
                        Text("System").tag("system")
                    }

                    Picker("Notification Level", selection: $vm.profile.notification_level) {
                        Text("Low").tag("low")
                        Text("Medium").tag("medium")
                        Text("High").tag("high")
                        Text("Disaster Only").tag("disaster")
                    }

                    TextField("Timezone", text: $vm.profile.timezone)

                    Toggle("Screen Sharing", isOn: Binding(
                        get: { vm.profile.screen_sharing_enabled == 1 },
                        set: { vm.profile.screen_sharing_enabled = $0 ? 1 : 0 }
                    ))
                }

                Section("Security") {
                    Button {
                        showPasswordSheet = true
                    } label: {
                        Label("Change Password", systemImage: "lock.rotation")
                    }
                }

                // Save button
                Section {
                    Button {
                        Task { _ = await vm.save() }
                    } label: {
                        if vm.isSaving {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Save Profile")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(vm.isSaving)
                }
            }
            .navigationTitle("Profile")
            .alert("Error", isPresented: .init(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("OK") { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
            .alert("Success", isPresented: .init(
                get: { vm.successMessage != nil },
                set: { if !$0 { vm.successMessage = nil } }
            )) {
                Button("OK") { vm.successMessage = nil }
            } message: {
                Text(vm.successMessage ?? "")
            }
            .sheet(isPresented: $showPasswordSheet) {
                ChangePasswordView(vm: vm, isPresented: $showPasswordSheet)
            }
            .task { await vm.load() }
        }
    }
}

/// Password change form.
struct ChangePasswordView: View {
    @ObservedObject var vm: ProfileViewModel
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Current Password", text: $vm.currentPassword)
                    SecureField("New Password", text: $vm.newPassword)
                    SecureField("Confirm New Password", text: $vm.confirmPassword)
                }

                if let error = vm.error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            if await vm.changePassword() {
                                isPresented = false
                            }
                        }
                    }
                    .disabled(vm.currentPassword.isEmpty || vm.newPassword.isEmpty || vm.confirmPassword.isEmpty)
                }
            }
        }
    }
}
