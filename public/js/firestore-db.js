import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  query, orderBy, writeBatch, serverTimestamp, where, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getAuth, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) ;
}

// ---------- auth ----------

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return fbSignOut(auth);
}

// ---------- categories ----------

export function watchCategories(callback) {
  const q = query(collection(db, 'categories'), orderBy('sortOrder'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function createCategory(name, sortOrder) {
  await addDoc(collection(db, 'categories'), { name, sortOrder: sortOrder ?? 999 });
}

export async function deleteCategory(id) {
  await deleteDoc(doc(db, 'categories', id));
}

// ---------- products (with embedded specs array) ----------

export function watchProducts(callback) {
  const q = query(collection(db, 'products'), orderBy('seq'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data(), specs: d.data().specs || [] })));
  });
}

export async function createProduct({ name, categoryId, note, seq }) {
  const ref = await addDoc(collection(db, 'products'), {
    name, categoryId: categoryId || null, note: note || null, specs: [], seq: seq ?? 999999, createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(id, { name, categoryId, note }) {
  await updateDoc(doc(db, 'products', id), { name, categoryId: categoryId || null, note: note || null });
}

export async function setProductNew(id, isNew) {
  await updateDoc(doc(db, 'products', id), { isNew });
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, 'products', id));
  const histSnap = await getDocs(query(collection(db, 'priceHistory'), where('productId', '==', id)));
  if (!histSnap.empty) {
    const batch = writeBatch(db);
    histSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// ---------- specs (stored inside product.specs array) ----------

export async function addSpec(product, { spec_name, price }) {
  const spec = { id: newId(), spec_name, price: price === '' || price === undefined ? null : price };
  const specs = [...(product.specs || []), spec];
  await updateDoc(doc(db, 'products', product.id), { specs });
  if (spec.price !== null) {
    await addDoc(collection(db, 'priceHistory'), {
      productId: product.id, specId: spec.id, oldPrice: null, newPrice: spec.price, changedAt: serverTimestamp(),
    });
  }
}

export async function updateSpec(product, specId, { spec_name, price }) {
  const oldSpec = (product.specs || []).find((s) => s.id === specId);
  const newPrice = price === '' || price === undefined ? null : price;
  const specs = (product.specs || []).map((s) => (s.id === specId ? { ...s, spec_name, price: newPrice } : s));
  await updateDoc(doc(db, 'products', product.id), { specs });
  if (newPrice !== null && oldSpec && newPrice !== oldSpec.price) {
    await addDoc(collection(db, 'priceHistory'), {
      productId: product.id, specId, oldPrice: oldSpec.price ?? null, newPrice, changedAt: serverTimestamp(),
    });
  }
}

export async function deleteSpec(product, specId) {
  const specs = (product.specs || []).filter((s) => s.id !== specId);
  await updateDoc(doc(db, 'products', product.id), { specs });
}

export async function setSpecChanged(product, specId, justChanged) {
  const specs = (product.specs || []).map((s) => (s.id === specId ? { ...s, justChanged } : s));
  await updateDoc(doc(db, 'products', product.id), { specs });
}

export async function getSpecHistory(productId, specId) {
  const snap = await getDocs(query(
    collection(db, 'priceHistory'),
    where('productId', '==', productId),
  ));
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((h) => h.specId === specId);
  rows.sort((a, b) => (b.changedAt?.seconds || 0) - (a.changedAt?.seconds || 0));
  return rows;
}
