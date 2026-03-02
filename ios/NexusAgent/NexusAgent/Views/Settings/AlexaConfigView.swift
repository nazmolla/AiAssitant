import SwiftUI

/// Alexa integration configuration.
struct AlexaConfigView: View {
    @StateObject private var vm = SettingsViewModel()
    @State private var ubidMain = ""
    @State private var atMain = ""
    @State private var isEditing = false
    @State private var isSaving = false
    @State private var showSuccess = false

    var body: some View {
        Form {
            Section {
                if let config = vm.alexaConfig {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(config.configured ? "Configured" : "Not Configured")
                            .foregroundStyle(config.configured ? .green : .secondary)
                    }
                } else {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text("Not Configured")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Credentials") {
                if isEditing {
                    SecureField("UBID Main", text: $ubidMain)
                    SecureField("AT Main", text: $atMain)
                } else {
                    HStack {
                        Text("UBID Main")
                        Spacer()
                        Text(vm.alexaConfig?.ubidMain ?? "Not set")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("AT Main")
                        Spacer()
                        Text(vm.alexaConfig?.atMain ?? "Not set")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section {
                if isEditing {
                    Button {
                        Task {
                            isSaving = true
                            if await vm.updateAlexaConfig(ubidMain: ubidMain, atMain: atMain) {
                                isEditing = false
                                showSuccess = true
                            }
                            isSaving = false
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(ubidMain.isEmpty || atMain.isEmpty || isSaving)

                    Button("Cancel", role: .cancel) {
                        isEditing = false
                    }
                } else {
                    Button("Edit Credentials") {
                        isEditing = true
                    }
                }
            }
        }
        .navigationTitle("Alexa")
        .alert("Success", isPresented: $showSuccess) {
            Button("OK") {}
        } message: {
            Text("Alexa configuration updated.")
        }
        .task { await vm.loadAlexaConfig() }
    }
}
