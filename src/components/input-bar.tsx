"use client";

import { memo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import type { PendingFile } from "./chat-panel-types";
import { ACCEPT_STRING } from "./chat-panel-types";

export interface InputBarProps {
  input: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  loading: boolean;
  activeThread: string | null;
  pendingFiles: PendingFile[];
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePendingFile: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  recording: boolean;
  transcribing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  screenShareEnabled: boolean;
  screenSharing: boolean;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  audioMode: boolean;
  audioModeSpeaking: boolean;
  onToggleAudioMode: () => void;
  latestFrameRef: React.MutableRefObject<string | null>;
  frameImgRef: React.RefObject<HTMLImageElement | null>;
  /** When true, renders a large centered welcome-mode input (no border-top strip) */
  welcomeMode?: boolean;
}

export const InputBar = memo(function InputBar({
  input,
  onInputChange,
  onSendMessage,
  loading,
  activeThread,
  pendingFiles,
  onFileSelect,
  onRemovePendingFile,
  fileInputRef,
  recording,
  transcribing,
  onStartRecording,
  onStopRecording,
  screenShareEnabled,
  screenSharing,
  onStartScreenShare,
  onStopScreenShare,
  audioMode,
  audioModeSpeaking,
  onToggleAudioMode,
  latestFrameRef,
  frameImgRef,
  welcomeMode = false,
}: InputBarProps) {
  const canSend = !loading && (!!input.trim() || pendingFiles.length > 0 || screenSharing);

  const indicators = (
    <>
      {/* Screen sharing indicator */}
      {screenSharing && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: "error.main", color: "error.contrastText", opacity: 0.9 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "white", animation: "pulse 1.5s infinite" }} />
          <Typography variant="caption" sx={{ fontWeight: 500 }}>Sharing your screen</Typography>
          {/* eslint-disable-next-line @next/next/no-img-element -- live screen-share frames use an imperative ref; next/image cannot manage ref-assigned src */}
          <img
            ref={frameImgRef}
            alt="Screen preview"
            style={{ height: 32, borderRadius: 4, marginLeft: "auto" }}
          />
          <Button
            size="small"
            variant="text"
            onClick={onStopScreenShare}
            sx={{ color: "inherit", minWidth: 0 }}
          >
            Stop
          </Button>
        </Box>
      )}

      {/* Audio mode indicator */}
      {audioMode && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: "primary.main", color: "primary.contrastText", opacity: 0.9 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "white", animation: "pulse 1.5s infinite" }} />
          <MicIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ fontWeight: 500 }}>
            {audioModeSpeaking ? "Speaking..." : recording ? "Listening..." : transcribing ? "Transcribing..." : loading ? "Thinking..." : "Audio mode active"}
          </Typography>
          <Button
            size="small"
            variant="text"
            onClick={onToggleAudioMode}
            sx={{ color: "inherit", minWidth: 0, ml: "auto" }}
          >
            Stop
          </Button>
        </Box>
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          {pendingFiles.map((pf, idx) => (
            <Chip
              key={`${pf.file.name}-${pf.file.lastModified}`}
              label={pf.file.name}
              size="small"
              variant="outlined"
              icon={pf.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- previewUrl is a blob: object URL; next/image does not support blob: URLs
                <img
                  src={pf.previewUrl}
                  alt={pf.file.name}
                  style={{ height: 20, width: 20, objectFit: "cover", borderRadius: 4 }}
                />
              ) : undefined}
              onDelete={() => onRemovePendingFile(idx)}
              sx={{ maxWidth: 180 }}
            />
          ))}
        </Box>
      )}
    </>
  );

  const inputRow = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_STRING}
        onChange={onFileSelect}
        style={{ display: "none" }}
      />
      <IconButton
        size="small"
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        title="Attach files"
      >
        <AttachFileIcon fontSize="small" />
      </IconButton>
      {screenShareEnabled && (
        <IconButton
          size="small"
          onClick={screenSharing ? onStopScreenShare : onStartScreenShare}
          disabled={loading || !activeThread}
          title={screenSharing ? "Stop screen sharing" : "Share your screen"}
          color={screenSharing ? "error" : "default"}
        >
          {screenSharing ? <StopScreenShareIcon fontSize="small" /> : <ScreenShareIcon fontSize="small" />}
        </IconButton>
      )}
      {!audioMode && (
        <IconButton
          size="small"
          onClick={recording ? onStopRecording : onStartRecording}
          disabled={loading || transcribing || !activeThread}
          title={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Voice input"}
          color={recording ? "error" : "default"}
          sx={recording ? { animation: "pulse 1.5s infinite", "@keyframes pulse": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.5 } } } : {}}
        >
          {transcribing ? (
            <CircularProgress size={18} color="inherit" />
          ) : recording ? (
            <MicOffIcon fontSize="small" />
          ) : (
            <MicIcon fontSize="small" />
          )}
        </IconButton>
      )}
      <TextField
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSendMessage();
          }
        }}
        placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : welcomeMode ? "Ask Nexus anything..." : "Message Nexus..."}
        disabled={loading}
        size={welcomeMode ? "medium" : "small"}
        fullWidth
        variant="outlined"
        multiline
        maxRows={welcomeMode ? 8 : 6}
        inputProps={{ style: { lineHeight: 1.6 } }}
        sx={welcomeMode ? {
          "& .MuiOutlinedInput-root": {
            borderRadius: 3,
            fontSize: "1rem",
            bgcolor: "background.paper",
          },
        } : {}}
      />
      <IconButton
        onClick={onSendMessage}
        disabled={!canSend}
        color="primary"
        title="Send message"
        size={welcomeMode ? "medium" : "small"}
        sx={welcomeMode ? {
          bgcolor: "primary.main",
          color: "primary.contrastText",
          "&:hover": { bgcolor: "primary.dark" },
          "&:disabled": { bgcolor: "action.disabledBackground" },
          width: 44,
          height: 44,
          flexShrink: 0,
        } : {}}
      >
        {loading ? (
          <CircularProgress size={20} color="inherit" />
        ) : (
          <SendIcon fontSize="small" />
        )}
      </IconButton>
    </Box>
  );

  if (welcomeMode) {
    return (
      <Box sx={{ width: "100%", maxWidth: 720, mx: "auto", px: 2 }}>
        {indicators}
        <Paper
          elevation={4}
          sx={{
            borderRadius: 4,
            p: 1.5,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
          }}
        >
          {inputRow}
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", p: 1.5, bgcolor: "background.paper" }}>
      <Box sx={{ maxWidth: 720, mx: "auto" }}>
        {indicators}
        {inputRow}
      </Box>
    </Box>
  );
});
