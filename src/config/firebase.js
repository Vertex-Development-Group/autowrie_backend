import * as admin from 'firebase-admin';
import * as path from 'path';
// Initialize Firebase app only once
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(path.join(__dirname, './firebaseServiceAccount.json')),
    });
   
}
else {
    console.log("Firebase app already initialized.");
}
const db = admin.firestore(); // Get Firestore instance
db.settings({
    ignoreUndefinedProperties: true
});
export { db, admin };
