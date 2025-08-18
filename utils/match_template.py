import cv2
import numpy as np


def to_grayscale(image):
    """
    Convert an image to grayscale.

    Args:
        image: The image to convert.
    """
    # if len(image.shape) == 2:  # Already grayscale
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def is_match_template(image, template, method=cv2.TM_CCOEFF_NORMED, threshold=0.85):
    """
    Check if a template image is present within an image.

    Args:
        image: The larger image to search within.
        template: The template image to search for.
        method: The method to use for template matching.
        threshold: The threshold to determine if a match is valid.

    Return:
        True if a match is found, False otherwise.
    """
    # Ensure image and template is a NumPy array
    if not isinstance(image, np.ndarray):
        image = np.array(image)

    if not isinstance(template, np.ndarray):
        template = np.array(template)

    # Convert to grayscale
    image_gray = to_grayscale(image)
    template_gray = to_grayscale(template)

    # Perform template matching
    result = cv2.matchTemplate(image_gray, template_gray, method)

    # Max-value check
    _, max_val, _, _ = cv2.minMaxLoc(result)

    # Check if any matches found
    return max_val >= threshold
