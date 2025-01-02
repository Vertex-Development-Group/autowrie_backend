import { db, admin } from './firebase.js';

interface Article {
  content: string;
  url?: string;
  savedAt?: string;
  [key: string]: any; // For other potential properties
}

export async function saveArticlesToFirebase(articles: Article[], searchQuery: string) {
  try {
    if (articles.length === 0) {
      console.log('No articles to save');
      return;
    }

    // Create a clean filename from the search query
    const cleanQuery = searchQuery.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .trim();
    const timestamp = new Date().toISOString().split('T')[0];
    
    // Create a unique document ID using the query and timestamp
    const docId = `${cleanQuery}-${timestamp}`;

    // Save articles in a single batch with the custom ID
    const batchRef = db.collection('articleBatches').doc(docId);
    
    // Check if this document already exists
    const doc = await batchRef.get();
    if (doc.exists) {
      console.log(`Articles for "${searchQuery}" already saved today`);
      return;
    }

    // Save the articles with metadata
    await batchRef.set({
      articles: articles,
      searchQuery: searchQuery,
      createdAt: new Date().toISOString(),
      articleCount: articles.length
    });

    console.log(`Saved ${articles.length} articles for "${searchQuery}" to Firebase`);
  } catch (error) {
    console.error('Error saving articles to Firebase:', error);
    throw error;
  }
}
