/**
 * Local Transcription Service using Vosk
 * Transcribes audio streams from Android device locally (offline)
 */

const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

let vosk = null;
let model = null;
let recognizer = null;
let isInitialized = false;
let modelPath = null;

// Default model path (user can download models from https://alphacephei.com/vosk/models)
const DEFAULT_MODEL_PATH = path.join(app.getPath('userData'), 'vosk-models', 'vosk-model-small-en-us-0.15');

/**
 * Initialize Vosk transcription service
 * @param {string} customModelPath - Optional custom path to Vosk model
 * @returns {Promise<boolean>} - True if initialized successfully
 */
async function initializeTranscription(customModelPath = null) {
    try {
        // Try to load vosk module
        try {
            vosk = require('vosk');
        } catch (e) {
            console.error('[Transcription] Vosk module not found. Install with: npm install vosk');
            return false;
        }

        // Determine model path
        modelPath = customModelPath || DEFAULT_MODEL_PATH;

        // Check if model exists
        if (!fs.existsSync(modelPath)) {
            const modelDir = path.dirname(modelPath);
            console.warn(`[Transcription] Model not found at: ${modelPath}`);
            console.warn('[Transcription] Transcription will be unavailable until model is installed');
            console.warn('[Transcription] Download from: https://alphacephei.com/vosk/models');
            console.warn(`[Transcription] Recommended: vosk-model-small-en-us-0.15 (39MB)`);
            console.warn(`[Transcription] Extract to: ${modelDir}`);
            
            // Ensure directory exists for future model placement
            try {
                fs.ensureDirSync(modelDir);
            } catch (e) {
                console.error(`[Transcription] Failed to create model directory: ${e.message}`);
            }
            
            // Return false but don't block - model can be added later
            return false;
        }

        // Set Vosk log level (0 = errors only, -1 = no logs)
        vosk.setLogLevel(-1);

        // Load model
        console.log(`[Transcription] Loading model from: ${modelPath}`);
        model = new vosk.Model(modelPath);
        
        // Create recognizer (16kHz, mono, for Android audio)
        recognizer = new vosk.Recognizer({ model: model, sampleRate: 16000 });
        recognizer.setWords(true); // Include word timestamps
        recognizer.setPartialWords(true); // Include partial words

        isInitialized = true;
        console.log('[Transcription] Vosk initialized successfully');
        return true;
    } catch (error) {
        console.error('[Transcription] Initialization error:', error.message);
        isInitialized = false;
        return false;
    }
}

/**
 * Process audio chunk and get transcription
 * @param {Buffer} audioBuffer - PCM16 audio data (16kHz, mono)
 * @returns {Object|null} - Transcription result or null
 */
function processAudioChunk(audioBuffer) {
    if (!isInitialized || !recognizer) {
        return null;
    }

    try {
        // Accept audio data (must be PCM16, 16kHz, mono)
        if (recognizer.acceptWaveform(audioBuffer)) {
            // Final result
            const result = recognizer.result();
            if (result && result.text) {
                return {
                    text: result.text,
                    final: true,
                    words: result.result || []
                };
            }
        } else {
            // Partial result
            const partial = recognizer.partialResult();
            if (partial && partial.partial) {
                return {
                    text: partial.partial,
                    final: false
                };
            }
        }
    } catch (error) {
        console.error('[Transcription] Processing error:', error.message);
    }

    return null;
}

/**
 * Get final result (call when stream ends)
 * @returns {Object|null} - Final transcription result
 */
function getFinalResult() {
    if (!isInitialized || !recognizer) {
        return null;
    }

    try {
        const result = recognizer.finalResult();
        if (result && result.text) {
            return {
                text: result.text,
                final: true,
                words: result.result || []
            };
        }
    } catch (error) {
        console.error('[Transcription] Final result error:', error.message);
    }

    return null;
}

/**
 * Reset recognizer (call when starting new stream)
 */
function resetRecognizer() {
    if (recognizer) {
        try {
            recognizer = new vosk.Recognizer({ model: model, sampleRate: 16000 });
            recognizer.setWords(true);
            recognizer.setPartialWords(true);
        } catch (error) {
            console.error('[Transcription] Reset error:', error.message);
        }
    }
}

/**
 * Check if transcription is available
 * @returns {boolean}
 */
function isAvailable() {
    return isInitialized && recognizer !== null;
}

/**
 * Get model info
 * @returns {Object}
 */
function getModelInfo() {
    return {
        initialized: isInitialized,
        modelPath: modelPath,
        modelExists: modelPath ? fs.existsSync(modelPath) : false
    };
}

module.exports = {
    initializeTranscription,
    processAudioChunk,
    getFinalResult,
    resetRecognizer,
    isAvailable,
    getModelInfo
};

