import pytesseract
from PIL import Image
import numpy as np
import cv2
import os
import re

# Configure Tesseract to use the custom trained data
tessdata_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'tessdata')
os.environ['TESSDATA_PREFIX'] = tessdata_dir

# Precompile regular expressions for better performance
# arrow_pattern = re.compile(r'[❯❯❯❯❯❯]+')
arrow_pattern = re.compile(r'[❯»►▶▷]+')
uppercase_pattern = re.compile(r'[A-Z]')
valid_start_pattern = re.compile(r'^[#@A-Za-z0-9]')

def extract_event_name_text(pil_img: Image.Image) -> str:
    """Extract event name text from image using Tesseract OCR with white background preprocessing."""
    try:
        # Convert PIL image to numpy array for preprocessing
        img_np = np.array(pil_img)

        # Apply white background preprocessing
        if len(img_np.shape) == 3:
            # Convert to grayscale
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = img_np

        # Create white background by inverting and thresholding
        # This helps with text that might be on dark backgrounds
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

        # Convert back to PIL for OCR
        processed_img = Image.fromarray(binary)

        # Use the processed image for OCR
        text = pytesseract.image_to_string(processed_img, lang='eng')

        # Basic cleanup
        text = text.strip()
        # Don't remove parentheses - they're important for events like "At Summer Camp (Year 2)"
        # text = re.sub(r'[()]+', '', text)  # Remove parentheses

        # Remove common OCR artifacts
        text = arrow_pattern.sub('', text)  # Remove arrow symbols

        # Smarter filtering with valid_start_pattern
        if not valid_start_pattern.match(text):
            # Remove everything before the first uppercase letter
            match = uppercase_pattern.search(text)
            if match:
                text = text[match.start():]

        return text.strip()

    except Exception as e:
        print(f"[WARNING] Event name OCR extraction failed: {e}")
        return ""
