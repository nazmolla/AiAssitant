"use client";

import { useState, useRef } from "react";
import type { PendingFile, AttachmentMeta } from "@/components/chat-panel-types";

export interface UseFileUploadReturn {
  pendingFiles: PendingFile[];
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removePendingFile: (index: number) => void;
  uploadFile: (file: File, threadId: string) => Promise<AttachmentMeta>;
}

export function useFileUpload(): UseFileUploadReturn {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const newPending: PendingFile[] = Array.from(files).map((file) => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      uploading: false,
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);
    e.target.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => {
      const copy = [...prev];
      if (copy[index].previewUrl) URL.revokeObjectURL(copy[index].previewUrl!);
      copy.splice(index, 1);
      return copy;
    });
  }

  async function uploadFile(file: File, threadId: string): Promise<AttachmentMeta> {
    const form = new FormData();
    form.append("file", file);
    form.append("threadId", threadId);
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Upload failed");
    }
    return res.json();
  }

  return {
    pendingFiles,
    setPendingFiles,
    fileInputRef,
    handleFileSelect,
    removePendingFile,
    uploadFile,
  };
}
