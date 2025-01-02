import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

// Get the current directory and file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Initializing Firebase...");
try {
    // Read the service account JSON file
    const serviceAccountPath = path.join(__dirname, './firebaseServiceAccount.json');
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

    console.log("Service Account Path:", serviceAccountPath);

    // Initialize Firebase
    initializeApp({
        credential: cert(serviceAccount), // Pass the parsed JSON object, not the file path
    });

    console.log("Firebase initialized successfully.");
} catch (error) {
    console.error("Error initializing Firebase:", error);
}

// Initialize Firestore
const db = getFirestore();
db.settings({
    ignoreUndefinedProperties: true,
});

export { db,admin };
