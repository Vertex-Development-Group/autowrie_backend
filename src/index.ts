import express, { Request, Response } from 'express';
import { searchBitcoinPrice } from './searchBitcoinPrice.js';
import cors from 'cors';
// import { OpenAI } from 'openai';
import bodyParser from 'body-parser';
import { admin, db } from './config/firebase.js';
import { Pinecone } from '@pinecone-database/pinecone';
import { saveArticlesToFirebase } from './config/saveArticlesToFirebase.js';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { PromptTemplate } from '@langchain/core/prompts';
import { LLMChain } from 'langchain/chains';
import { loadQAStuffChain, loadSummarizationChain } from 'langchain/chains';
import { Document } from '@langchain/core/documents';
import multer from 'multer';
import { OpenAI }  from 'openai';
import  sharp from 'sharp';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';



const app = express();
const port = 5000;
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '50mb' })); 
app.use(cors({
    origin: 'http://localhost:3000', // Allow your frontend
  }));

  app.use((req, res, next) => {
    console.log(`Request body size: ${JSON.stringify(req.body).length} bytes`);
    next();
  });
 
  app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
dotenv.config();
const openai = new OpenAI(
    {
    apiKey: process.env.OPENAI_API_KEY,
    }
  );

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const MAX_TOKENS = 16000; // Token limit for gpt-3.5-turbo
const MAX_RESPONSE_TOKENS = 1000; // Max response tokens to leave room for input tokens
const CHUNK_SIZE = 12000; // Smaller than max tokens to leave room for system prompt and response
const CHUNK_OVERLAP = 500; // To maintain context between chunks

// Utility function to count tokens (approximation)
const countTokens = (text: string) => {
  // Approximate token count based on average word length (may need refinement)
  return Math.ceil(text.length / 4);
};

// Utility function to chunk content based on token count (estimate)
const chunkContent = (content: string, maxTokens: number = MAX_TOKENS - MAX_RESPONSE_TOKENS) => {
  const chunks: string[] = [];
  let currentChunk = '';
  let currentTokenCount = 0;

  const words = content.split(' ');
  for (const word of words) {
    const tokenCount = countTokens(word); // Approximate token count per word
    if (currentTokenCount + tokenCount <= maxTokens) {
      currentChunk += ` ${word}`;
      currentTokenCount += tokenCount;
    } else {
      chunks.push(currentChunk.trim());
      currentChunk = word;
      currentTokenCount = tokenCount;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
};

// Add this helper function
async function summarizeChunk(chunk: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `Create a structured summary following these rules:
        - Create 3-4 main sections with clear headings
        - Each section should have exactly 5 lines of text
        - Maintain a clear narrative flow
        - Use proper paragraph formatting
        - Each paragraph should be detailed and informative
        - End each section with a clear conclusion`,
      },
      {
        role: "user",
        content: `Analyze this content and create a structured summary with exactly 5 lines per paragraph:\n\n${chunk}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 1000,
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

app.post('/api/generate-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { allBatches } = req.body;

    if (!allBatches || !Array.isArray(allBatches) || allBatches.length === 0) {
      res.status(400).json({ error: 'No batches provided' });
      return;
    }

    // Collect all content
    const allContent = allBatches
      .flatMap((batch: any) => batch.articles)
      .map((article: any) => `${article.title}\n${article.content}`)
      .join('\n\n');

    // Split text into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
    const chunks = await textSplitter.splitText(allContent);

    // Get summary for each chunk
    const chunkSummaries = await Promise.all(
      chunks.map(chunk => summarizeChunk(chunk))
    );

    // If we have multiple summaries, combine them
    let finalSummary = chunkSummaries.join('\n\n');
    if (chunkSummaries.length > 1) {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `Create a well-structured article with exactly:
            - 3-4 main sections
            - Each section must have a clear heading
            - Each section must have exactly 5 lines of text
            - Maintain professional tone and clear transitions
            - Ensure each paragraph is substantive and complete
            - Format should be: Heading, followed by 5 lines of text, then next heading`,
          },
          {
            role: "user",
            content: `Combine these summaries into a coherent article with 5-line paragraphs:\n\n${chunkSummaries.join('\n\n')}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });
      finalSummary = response.choices[0]?.message?.content?.trim() || finalSummary;
    }

    // Instead of limiting to 20 lines, we'll ensure proper formatting
    const formattedSummary = finalSummary;

    // Save the structured summary to Firebase
    const summaryDoc = await db.collection('article_summaries').add({
      content: formattedSummary,
      createdAt: new Date(),
      originalBatchCount: allBatches.length,
      articleCount: allBatches.reduce((count: number, batch: any) => 
        count + (batch.articles?.length || 0), 0
      )
    });

    res.json({
      success: true,
      unifiedSummary: formattedSummary,
      summaryId: summaryDoc.id
    });
  } catch (error: any) {
    console.error('Error in generate-summary:', error.message || error.toString());
    res.status(500).json({
      error: 'Error generating summary',
      details: error.message || error.toString(),
    });
  }
});

const activeSearches = new Map<string, boolean>();

app.get('/search', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const query = req.query.q as string;

    if (!query) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    // Get search results
    const results = await searchBitcoinPrice(query);

    // Check if we got any results
    if (!results || results.length === 0) {
      res.status(404).json({ message: 'No articles found' });
      return;
    }

    // Log the number of results before saving
    console.log(`Found ${results.length} articles for "${query}"`);

    // Pass the search query to saveArticlesToFirebase
    await saveArticlesToFirebase(results, query);

    res.json({ 
      message: 'Articles saved successfully', 
      count: results.length,
      results 
    });

  } catch (error) {
    console.error('Error in search endpoint:', error);
    res.status(500).json({ error: 'An error occurred while processing articles' });
  }
});

// Updated articlesRoute
app.get('/api/articles', async (req: Request, res: Response): Promise<void> => {
  try {
    const articlesSnapshot = await db.collection('article_summarize')
      .orderBy('createdAt', 'desc')
      .get();
    
    const articles = articlesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    if (articles.length === 0) {
      res.status(404).json({ error: 'No articles found' });
      return;
    }

    res.json(articles);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Error fetching articles' });
  }
});

app.get('/api/articles/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const articleDoc = await db.collection('article_summarize').doc(id).get();
    
    if (!articleDoc.exists) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    const article = {
      id: articleDoc.id,
      ...articleDoc.data()
    };

    res.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'Error fetching article' });
  }
});






app.post('/save-article', async (req, res): Promise<void> => {
  try {
    const { content } = req.body;

    if (!content || content.trim() === '') {
      res.status(400).json({ message: 'Content is required.' });
      return;
    }

    // Generate multiple titles using OpenAI Chat Completions
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Generate 3 different engaging titles for the article. Each title should be unique and capture different aspects of the content. Format them as "1. [First Title] 2. [Second Title] 3. [Third Title]"',
        },
        {
          role: 'user',
          content: `Generate three different titles for the following content:\n\n${content}`,
        },
      ],
      max_tokens: 100,
      n: 1,
      temperature: 0.8, // Increased for more variety
    });

    const choice = response.choices?.[0];
    const message = choice?.message;

    if (!message || !message.content) {
      res.status(500).json({ message: 'Failed to generate titles.' });
      return;
    }

    // Parse the titles from the response
    const titlesText = message.content.trim();
    const titleMatches = titlesText.match(/\d\.\s*([^\n]+)/g) || [];
    const titles = titleMatches.map(match => {
      return match.replace(/^\d\.\s*/, '').trim();
    });

    // Create titles object with numbered keys
    const titlesObject = titles.reduce((acc, title, index) => {
      acc[`title${index + 1}`] = title;
      return acc;
    }, {} as Record<string, string>);

    // 2. Generate image using DALL-E
    const imagePrompt = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Generate a short, descriptive prompt for DALL-E to create a thumbnail image based on the article content. The prompt should be concise and visual.',
        },
        {
          role: 'user',
          content: `Generate an image prompt for this article content:\n\n${content}`,
        },
      ],
      max_tokens: 100,
    });

    const imagePromptText = imagePrompt.choices[0]?.message?.content || '';
    
    // Generate image with DALL-E
    const image = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePromptText,
      n: 1,
      size: "1024x1024",
    });

    // 3. Upload to Cloudinary
    const imageUrl = image.data[0]?.url;
    if (!imageUrl) {
      throw new Error('Failed to generate image');
    }

    const cloudinaryResponse = await cloudinary.uploader.upload(imageUrl, {
      folder: 'article-thumbnails',
    });

    // 4. Save to Firestore with image data
    const docRef = await db.collection('article_summarize').add({
      ...titlesObject,
      content,
      createdAt: Date.now(),
      titleCount: titles.length,
      thumbnail: {
        url: cloudinaryResponse.secure_url,
        publicId: cloudinaryResponse.public_id,
        prompt: imagePromptText
      }
    });

    console.log("Generated titles and thumbnail:", { titles: titlesObject, thumbnail: cloudinaryResponse.secure_url });
    
    res.status(201).json({
      message: 'Article saved successfully.',
      id: docRef.id,
      titles: titlesObject,
      thumbnail: cloudinaryResponse.secure_url
    });
  } catch (error) {
    console.error('Error saving article:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


app.post('/api/saveUserInput', async (req, res):Promise<void> => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    res.status(400).json({ error: 'All fields are required.' });
    return
  }

  try {
    // Save user input to Firestore
    const docRef = await db.collection('userInputs').add({
      name,
      email,
      message,
      timestamp: new Date()
    });

    res.status(200).json({ success: true, message: 'Data saved successfully!', docId: docRef.id });
  } catch (error) {
    console.error('Error saving data to Firestore:', error);
    res.status(500).json({ success: false, error: 'Failed to save data to Firestore.' });
  }
});

// Add this new endpoint for getting batches
app.get('/api/batches', async (req: Request, res: Response): Promise<void> => {
  try {
    const batchesSnapshot = await db.collection('articleBatches')
      .orderBy('createdAt', 'desc')
      .get();
    
    const batches = batchesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    if (batches.length === 0) {
      res.status(404).json({ error: 'No batches found' });
      return;
    }

    res.json({
      count: batches.length,
      batches: batches
    });
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Error fetching article batches' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


