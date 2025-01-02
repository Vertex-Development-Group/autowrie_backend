import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

// Remove https and process imports as we won't need them
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Initializing Firebase...");

try {
  const serviceAccountPath = path.join(__dirname, './firebaseServiceAccount.json');
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

  // Simplified initialization without SSL modifications
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount)
    });
  }

  console.log("Firebase initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase:", error);
  process.exit(1);
}

// Initialize Firestore with optional settings
const db = getFirestore();
db.settings({
  ignoreUndefinedProperties: true,
});

export { db, admin };
