import {variant} from './art-card-bank-variant.js';
await import('./art-card-upload-replay-fixture-v4.js');
window.cardUploadReplay.variant=variant;

const response=await fetch('/exact-corpus.json');if(!response.ok)throw new Error('Exact corpus HTTP fetch failed');window.__exactCorpus=await response.json();window.cardUploadReplay.inputsReady=true;
