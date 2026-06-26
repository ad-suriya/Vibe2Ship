import os
import subprocess

# API key should be set via .env file or environment variable
# Do not hardcode secrets in the source code
if 'GEMINI_API_KEY' not in os.environ:
    raise ValueError('GEMINI_API_KEY environment variable is not set. Please set it in your .env file.')

# Run the FastAPI app
import uvicorn
from main import app

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8000)
