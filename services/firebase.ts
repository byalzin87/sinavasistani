import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { Folder } from '../types';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

// Initialize Firebase with user provided config
export const initFirebase = (config: FirebaseConfig) => {
  if (getApps().length === 0) {
    app = initializeApp(config);
  } else {
    app = getApp();
  }
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
};

export const getFirebaseServices = () => ({ app, auth, db });

export const isFirebaseInitialized = () => !!app;

// Helper to convert username to fake email (Firebase requires email)
const getEmail = (username: string) => `${username.trim().toLowerCase()}@sinavasistani.app`;

export const cloudLogin = async (username: string, password: string) => {
  if (!auth) throw new Error("Cloud servisi başlatılmadı.");
  try {
    const userCredential = await signInWithEmailAndPassword(auth, getEmail(username), password);
    return userCredential.user;
  } catch (error: any) {
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
       throw new Error("Kullanıcı bulunamadı veya şifre hatalı.");
    }
    throw error;
  }
};

export const cloudRegister = async (username: string, password: string) => {
  if (!auth) throw new Error("Cloud servisi başlatılmadı.");
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, getEmail(username), password);
    return userCredential.user;
  } catch (error: any) {
    if (error.code === 'auth/email-already-in-use') {
      throw new Error("Bu kullanıcı adı zaten alınmış.");
    }
    throw error;
  }
};

export const cloudLogout = async () => {
  if (!auth) return;
  await firebaseSignOut(auth);
};

export const saveUserData = async (userId: string, folders: Folder[]) => {
  if (!db) return;
  // We compress the data into a single document for simplicity
  await setDoc(doc(db, "users", userId), { 
    folders: JSON.stringify(folders),
    lastUpdated: new Date().toISOString()
  });
};

export const loadUserData = async (userId: string): Promise<Folder[] | null> => {
  if (!db) return null;
  const docRef = doc(db, "users", userId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    if (data.folders) {
      try {
        return JSON.parse(data.folders);
      } catch (e) {
        console.error("Cloud data parse error", e);
        return [];
      }
    }
  }
  return []; // User exists but no data yet
};