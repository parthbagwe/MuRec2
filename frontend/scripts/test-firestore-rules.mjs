import test from "node:test";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, deleteDoc } from "firebase/firestore";

const environment = await initializeTestEnvironment({ projectId: "demo-cerum-spark", firestore: {
  host: "127.0.0.1", port: 8085, rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
} });
const alice = environment.authenticatedContext("alice").firestore();
const bob = environment.authenticatedContext("bob").firestore();
const guest = environment.unauthenticatedContext().firestore();
const ref = (db, kind = "favorites", uid = "alice") => doc(db, "users", uid, "library", kind);
const value = (entries = []) => ({ entries, updated_at: serverTimestamp() });
test.after(() => environment.cleanup());

test("owner can save/read/delete own favourites", async () => {
  await assertSucceeds(setDoc(ref(alice), value([{ track_id: "song-1", title: "Song" }])));
  await assertSucceeds(getDoc(ref(alice)));
  await assertSucceeds(deleteDoc(ref(alice)));
});
test("guest and different account cannot read or overwrite library", async () => {
  for (const db of [bob, guest]) {
    await assertFails(getDoc(ref(db)));
    await assertFails(setDoc(ref(db), value()));
    await assertFails(deleteDoc(ref(db)));
  }
});
test("bounded owner histories and feedback are allowed", async () => {
  await assertSucceeds(setDoc(ref(alice, "history"), value(Array.from({ length: 30 }, () => ({ mode: "similar" })))));
  await assertSucceeds(setDoc(ref(alice, "interactions"), value([{ track_id: "song-2", event_type: "disliked" }])));
});
test("oversized lists, fake timestamps, extra fields and other document names fail", async () => {
  await assertFails(setDoc(ref(alice), value(Array(101).fill({ track_id: "song" }))));
  await assertFails(setDoc(ref(alice, "history"), value(Array(31).fill({ mode: "similar" }))));
  await assertFails(setDoc(ref(alice), { entries: [], updated_at: "yesterday" }));
  await assertFails(setDoc(ref(alice), { ...value(), admin: true }));
  await assertFails(setDoc(ref(alice, "anything"), value()));
});
test("public documents and collection scans are denied", async () => {
  await assertFails(getDocs(collection(alice, "users", "alice", "library")));
  await assertFails(setDoc(doc(alice, "public", "test"), { open: true }));
});
