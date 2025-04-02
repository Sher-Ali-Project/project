const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require("dotenv");
const multer = require('multer');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({ storage: multer.memoryStorage() });
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Validate API key
if (!GEMINI_API_KEY) {
  console.error('❌ Missing GEMINI_API_KEY in .env file!');
  process.exit(1);
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Conversation memory with expiration
const sessions = {};
const SESSION_EXPIRY = 30 * 60 * 1000; // 30 minutes

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(limiter); // Apply rate limiting to all requests

// Clean up expired sessions
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(sessionId => {
    if (sessions[sessionId].lastActive < now - SESSION_EXPIRY) {
      delete sessions[sessionId];
    }
  });
}, 60 * 1000); // Run every minute

// Gemini API call function
async function callGemini(contents) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await axios.post(url, { contents }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return response.data?.candidates?.[0]?.content || { parts: [{ text: "No response from AI." }] };
  } catch (error) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    throw new Error('Failed to get AI response');
  }
}

// AI Endpoint
app.post('/api/ai', upload.single('image'), async (req, res) => {
  try {
    const { prompt, sessionId = 'default' } = req.body;
    const image = req.file;

    if (!prompt && !image) {
      return res.status(400).json({ error: 'Either text or image is required' });
    }

    // Initialize or update session
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        history: [],
        lastActive: Date.now()
      };
    }
    sessions[sessionId].lastActive = Date.now();
    const history = sessions[sessionId].history;

    const newContent = { role: 'user', parts: [] };

    if (prompt) newContent.parts.push({ text: prompt });
    if (image) {
      newContent.parts.push({
        inlineData: {
          mimeType: image.mimetype,
          data: image.buffer.toString('base64')
        }
      });
    }

    history.push(newContent);
    const aiResponse = await callGemini([...history]);
    history.push({ role: 'assistant', parts: aiResponse.parts });

    res.json({ response: aiResponse.parts[0].text });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      error: error.message || "AI request failed",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server ready at http://localhost:${PORT}`);
  console.log(`🔗 Test with:`);
  console.log(`curl -X POST http://localhost:${PORT}/api/ai \\\n  -H "Content-Type: application/json" \\\n  -d '{"prompt":"Hello"}'`);
});