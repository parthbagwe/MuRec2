import { inferAudio } from '../server/audioInference.js';
import { createInferenceHandler } from '../server/inferenceHandler.js';
export default createInferenceHandler(inferAudio);
