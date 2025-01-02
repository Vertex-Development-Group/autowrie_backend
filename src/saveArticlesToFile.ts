import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mimic `__dirname` in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to save scraped articles to a file
export async function saveScrapedArticlesToFile(articles: any[]) {
  const dirPath = path.join(__dirname, 'scrapedArticles'); // Folder where files will be saved
  
  // Create the directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
  
  const timestamp = Date.now();
  const filePath = path.join(dirPath, `articles_${timestamp}.json`);

  try {
    // Write articles to a new file
    fs.writeFileSync(filePath, JSON.stringify(articles, null, 2)); // Pretty-print with 2 spaces indentation
    console.log(`Articles saved to ${filePath}`);
  } catch (error) {
    console.error('Error saving articles to file:', error);
  }
}
