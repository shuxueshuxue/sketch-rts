import './art-card-bank-variant.js';
import './art-card-upload-depth1-fixture.js';
fetch('/exact-corpus.json').then(r=>{if(!r.ok)throw new Error('Actual corpus HTTP '+r.status);return r.json();}).then(value=>{window.__exactCorpus=value;window.cardUploadReplay.inputsReady=true;});
