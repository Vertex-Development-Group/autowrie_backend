/* eslint-disable @typescript-eslint/no-unused-vars */
import puppeteer from 'puppeteer';
import { admin, db } from './config/firebase.js';
import { saveArticlesToFirebase } from './config/saveArticlesToFirebase.js';
import { saveScrapedArticlesToFile } from './saveArticlesToFile.js';
import { Page } from 'puppeteer';

// Add new interface for unified results
interface SearchResult {
  title: string;
  link: string;
  content: string;
  source: 'google' | 'twitter';
}

export async function searchBitcoinPrice(query: string): Promise<SearchResult[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  
  // Collect results from both sources
  const googleResults = await scrapeGoogleResults(page, query);
  const twitterResults = await scrapeTwitterResults(page, query);
  
  await browser.close();
  
  // Combine results
  const allResults = [...googleResults, ...twitterResults];
  
  // Save combined results
  await saveArticlesToFirebase(allResults, query);
  // await saveScrapedArticlesToFile(allResults);

  return allResults;
}

async function scrapeGoogleResults(page: Page, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const totalPages = 5;

  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${pageNum * 10}`;
    
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h3')).map((element) => ({
        title: element.innerText || 'No title',
        link: element.closest('a')?.href || 'No link',
      }));
    });

    for (const link of links) {
      if (link.link && link.link !== 'No link') {
        try {
          const articleContent = await scrapeArticleContent(link.link);

          results.push({
            title: link.title,
            link: link.link,
            content: articleContent || 'Content unavailable',
            source: 'google'
          });
        } catch (error) {
          console.error(`Error fetching content for link: ${link.link}`, error);
          results.push({
            title: link.title,
            link: link.link,
            content: 'Content unavailable',
            source: 'google'
          });
        }
      }
    }
  }
  
  return results;
}

async function scrapeTwitterResults(page: Page, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  try {
    // Updated URL to use x.com
    await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Wait for posts to load (X still uses tweet in their data-testid)
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });

    // Extract posts
    const posts = await page.evaluate(() => {
      const postElements = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(postElements, post => {
        const postText = post.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const postLink = (post.querySelector('a[href*="/status/"]') as HTMLAnchorElement)?.href || '';
        const username = post.querySelector('[data-testid="User-Name"]')?.textContent || '';
        
        return {
          title: `Post by ${username}`,
          link: postLink.replace('twitter.com', 'x.com'),
          content: postText,
          source: 'twitter' as const
        };
      });
    });

    results.push(...posts);
  } catch (error) {
    console.error('Error scraping X:', error);
  }
  
  return results;
}

async function scrapeArticleContent(url: string): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  
  try {
    await page.setRequestInterception(true);
    page.on('request', (request: { resourceType: () => string; abort: () => void; continue: () => void; }) => {
      if (request.resourceType() === 'image' || request.resourceType() === 'media') {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    const content = await page.evaluate(() => {
      const article = document.querySelector('article') || document.body;
      return article ? article.innerText : 'No content available';
    });

    return content;
  } catch (error) {
    console.error(`Error scraping content from ${url}:`, error);
    return 'Error fetching article content';
  } finally {
    await browser.close();
  }
}