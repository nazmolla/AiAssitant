import { getDb } from "./connection";
import { v4 as uuid } from "uuid";

export interface VoiceProfile {
  id: string;
  user_id: string;
  embedding: Buffer;
  enrolled_at: string;
}

/** Upsert a voice embedding for a user (one profile per user). */
export function upsertVoiceProfile(userId: string, embedding: Buffer): VoiceProfile {
  const db = getDb();
  const existing = getVoiceProfile(userId);
  if (existing) {
    db.prepare(
      "UPDATE voice_profiles SET embedding = ?, enrolled_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    ).run(embedding, userId);
    return getVoiceProfile(userId)!;
  }
  const id = uuid();
  return db
    .prepare(
      `INSERT INTO voice_profiles (id, user_id, embedding) VALUES (?, ?, ?) RETURNING *`
    )
    .get(id, userId, embedding) as VoiceProfile;
}

/** Get the voice profile for a specific user. */
export function getVoiceProfile(userId: string): VoiceProfile | undefined {
  return getDb()
    .prepare("SELECT * FROM voice_profiles WHERE user_id = ?")
    .get(userId) as VoiceProfile | undefined;
}

/** Get all enrolled voice profiles (used for speaker identification). */
export function listVoiceProfiles(): VoiceProfile[] {
  return getDb().prepare("SELECT * FROM voice_profiles").all() as VoiceProfile[];
}

/** Delete the voice profile for a user. */
export function deleteVoiceProfile(userId: string): void {
  getDb().prepare("DELETE FROM voice_profiles WHERE user_id = ?").run(userId);
}
