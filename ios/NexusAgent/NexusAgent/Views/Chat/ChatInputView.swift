import SwiftUI
import PhotosUI

/// Chat input bar with multiline text field, attachment support, and send button.
struct ChatInputView: View {
    @EnvironmentObject var chatVM: ChatViewModel
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var pendingAttachmentIds: [String] = []
    @State private var isUploading = false

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            // Pending attachments
            if !pendingAttachmentIds.isEmpty {
                HStack {
                    ForEach(pendingAttachmentIds, id: \.self) { id in
                        HStack(spacing: 4) {
                            Image(systemName: "paperclip")
                                .font(.caption2)
                            Text("Attachment")
                                .font(.caption2)
                            Button {
                                pendingAttachmentIds.removeAll { $0 == id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.caption2)
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial)
                        .clipShape(Capsule())
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }

            HStack(alignment: .bottom, spacing: 8) {
                // Attachment picker
                Menu {
                    PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                        Label("Photo", systemImage: "photo")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .disabled(chatVM.isStreaming || isUploading)

                // Text input (multiline)
                TextField("Message...", text: $chatVM.inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .onSubmit {
                        sendIfReady()
                    }

                // Send / Stop button
                if chatVM.isStreaming {
                    Button {
                        chatVM.cancelStreaming()
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.red)
                    }
                } else {
                    Button {
                        sendIfReady()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundStyle(canSend ? .accentColor : .gray)
                    }
                    .disabled(!canSend)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.bar)
        .onChange(of: selectedPhotoItem) { _, newItem in
            guard let item = newItem else { return }
            Task { await uploadPhoto(item) }
        }
    }

    private var canSend: Bool {
        !chatVM.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !chatVM.isStreaming && !isUploading
    }

    private func sendIfReady() {
        guard canSend else { return }
        let attachments = pendingAttachmentIds.isEmpty ? nil : pendingAttachmentIds
        pendingAttachmentIds = []
        Task { await chatVM.sendMessage(attachmentIds: attachments) }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) async {
        isUploading = true
        defer {
            isUploading = false
            selectedPhotoItem = nil
        }

        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        if let id = await chatVM.uploadAttachment(data: data, filename: "photo.jpg", mimeType: "image/jpeg") {
            pendingAttachmentIds.append(id)
        }
    }
}
