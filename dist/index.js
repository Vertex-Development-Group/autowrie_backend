import express from 'express';
import { searchBitcoinPrice } from './searchBitcoinPrice.js';
import cors from 'cors';
// import { OpenAI } from 'openai';
import bodyParser from 'body-parser';
import { db } from './config/firebase.js';
import { Pinecone } from '@pinecone-database/pinecone';
import { saveArticlesToFirebase } from './config/saveArticlesToFirebase.js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OpenAI } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { PromptTemplate } from '@langchain/core/prompts';
import { LLMChain } from 'langchain/chains';
import { Document } from '@langchain/core/documents';
const app = express();
const port = 5000;
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3000', // Allow your frontend
}));
app.use((req, res, next) => {
    console.log(`Request body size: ${JSON.stringify(req.body).length} bytes`);
    next();
});
app.use(bodyParser.raw({ limit: '100mb', type: 'application/json' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


const analysisTemplate = PromptTemplate.fromTemplate(`
  You MUST provide a concise yet comprehensive article analysis based on the content provided. The output must be 20–30 lines.

  1. TITLE (Make it compelling and specific to the content):
  Example: "Ethereum's 2030 Vision: Price Predictions and Technical Evolution Signal Major Growth"

  2. ARTICLE SYNTHESIS (20–30 lines, must include the following):

  Introduction:
  - Briefly introduce the overarching theme of the articles.

  Key Highlights:
  - Synthesize critical details, numbers, or statistics.
  - Summarize technical or market developments.

  Conclusion:
  - Outline future implications or trends.
  - Mention any key risks or opportunities.

  Content to analyze: {content}

  IMPORTANT:
  - Maintain a professional, engaging tone.
`);
app.post('/api/generate-summary', async (req, res) => {
    try {
        const { articles } = req.body;
        if (!articles || !Array.isArray(articles) || articles.length === 0) {
            throw new Error('No articles provided. Please provide a valid array of articles.');
        }
        console.log("Number of articles received:", articles.length);
        // Combine articles into a single content string
        const combinedContent = articles
            .map((article) => `Title: ${article.title}\n${article.content}`)
            .join('\n\n');
        // Split content into chunks
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 4000,
            chunkOverlap: 200,
        });
        const chunks = await textSplitter.splitText(combinedContent);
        if (!chunks.length) {
            throw new Error('Content splitting produced no chunks. Ensure input content is adequate.');
        }
        const docs = chunks.map(chunk => new Document({ pageContent: chunk }));
        if (!docs.length) {
            throw new Error('No valid documents generated from the input content.');
        }
        // Create embeddings and search for context
        const vectorStore = await PineconeStore.fromDocuments(docs, embeddings, {
            pineconeIndex: index,
            namespace: 'articles',
        });
        const similarDocs = await vectorStore.similaritySearch(combinedContent.slice(0, 1000), 3);
        if (!similarDocs.length) {
            throw new Error('No relevant documents found for the given content. Ensure embeddings are working.');
        }
        // Generate analysis and synthesis
        const chain = new LLMChain({ llm: model, prompt: analysisTemplate });
        const result = await chain.call({
            content: combinedContent,
            context: similarDocs.map(doc => doc.pageContent).join('\n\n'),
        });
        if (!result.text || result.text.trim().length === 0) {
            throw new Error('The analysis chain produced an empty response. Check the input or prompt structure.');
        }
        res.json({
            success: true,
            analysis: result.text,
            relatedDocsCount: similarDocs.length,
        });
    }
    catch (error) {
        console.error('Error in generate-summary:', error);
        res.status(500).json({
            error: 'Error generating summary',
            details: error.message,
        });
    }
});
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            res.status(400).json({ error: 'Search query is required' });
            return;
        }
        const results = await searchBitcoinPrice(query);
        // Assuming `saveArticlesToFirebase` is implemented
        await saveArticlesToFirebase(results);
        res.json({ message: 'Articles saved successfully', results });
    }
    catch (error) {
        console.error('Error saving articles:', error);
        res.status(500).json({ error: 'An error occurred while saving articles' });
    }
});
// Updated articlesRoute
app.get('/api/articles', async (req, res) => {
    try {
        const articlesSnapshot = await db.collection('articleBatches').get();
        const articles = [];
        articlesSnapshot.forEach((doc) => {
            articles.push(doc.data()); // Add each article data to the articles array
        });
        if (articles.length === 0) {
            res.status(404).json({ error: 'No articles found' });
            return;
        }
        res.json(articles); // Send the articles as a response
    }
    catch (error) {
        console.error('Error fetching articles from Firestore:', error);
        res.status(500).json({ error: 'Error fetching articles from Firestore' });
    }
});
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
