import { sampleFunction } from '@src/sample-function';
import { initializeContentCapture } from '@src/context-capture';
import { initializeFocusMode } from '@src/focus-blocking';

console.log('[CEB] All content script loaded');

void sampleFunction();
initializeContentCapture();
initializeFocusMode();
