import SwiftUI

/// Knowledge base list with search, add, and delete.
struct KnowledgeListView: View {
    @StateObject private var vm = KnowledgeViewModel()
    @State private var showAddSheet = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(vm.filteredEntries) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(entry.entity)
                                .font(.headline)
                                .foregroundStyle(.accentColor)
                            Text("·")
                                .foregroundStyle(.secondary)
                            Text(entry.attribute)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Text(entry.value)
                            .font(.body)

                        if let ctx = entry.source_context, !ctx.isEmpty {
                            Text(ctx)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .onDelete { indexSet in
                    let filtered = vm.filteredEntries
                    for index in indexSet {
                        Task { await vm.delete(filtered[index]) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $vm.searchText, prompt: "Search knowledge...")
            .navigationTitle("Knowledge")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable {
                await vm.load()
            }
            .sheet(isPresented: $showAddSheet) {
                KnowledgeFormView(vm: vm, isPresented: $showAddSheet)
            }
            .overlay {
                if vm.entries.isEmpty && !vm.isLoading {
                    ContentUnavailableView {
                        Label("No Knowledge", systemImage: "brain")
                    } description: {
                        Text("Knowledge entries will appear here as the agent learns.")
                    }
                }
            }
            .alert("Error", isPresented: .init(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("OK") { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
            .task { await vm.load() }
        }
    }
}

/// Form for adding a new knowledge entry.
struct KnowledgeFormView: View {
    @ObservedObject var vm: KnowledgeViewModel
    @Binding var isPresented: Bool

    @State private var entity = ""
    @State private var attribute = ""
    @State private var value = ""
    @State private var sourceContext = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Entity") {
                    TextField("e.g. Mohamed, Project Alpha", text: $entity)
                }
                Section("Attribute") {
                    TextField("e.g. role, deadline, location", text: $attribute)
                }
                Section("Value") {
                    TextField("e.g. Software Engineer, Q4 2025", text: $value)
                }
                Section("Source Context (Optional)") {
                    TextField("Where this info came from", text: $sourceContext)
                }
            }
            .navigationTitle("Add Knowledge")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let success = await vm.create(
                                entity: entity,
                                attribute: attribute,
                                value: value,
                                sourceContext: sourceContext.isEmpty ? nil : sourceContext
                            )
                            if success { isPresented = false }
                        }
                    }
                    .disabled(entity.isEmpty || attribute.isEmpty || value.isEmpty)
                }
            }
        }
    }
}
