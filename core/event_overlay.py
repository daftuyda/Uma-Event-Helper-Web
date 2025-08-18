import json
import os
import time
import pyautogui
import re
import tkinter as tk
from tkinter import ttk
from pyautogui import ImageNotFoundException
from utils.screenshot import capture_region
from core.ocr import extract_event_name_text

import cv2
import numpy as np
from utils.match_template import is_match_template


# Precompile regular expressions for better performance
l_pattern = re.compile(r'l\b')
l_exclamation_pattern = re.compile(r'l([!?.,])')
double_exclamation_pattern = re.compile(r'[!l]{2,}')
trailing_exclamation_pattern = re.compile(r'!+$')
trailing_letter_pattern = re.compile(r'\s+[A-Za-z]\s*$')
trailing_letter_pattern2 = re.compile(r'[A-Za-z]\s*$')


class EventOverlay:
    def __init__(self):
        self.event_region = (240, 200, 365, 45)
        self.overlay_x = 958
        self.overlay_y = 810
        self.overlay_width = 798
        self.overlay_height = 269
        self.support_events = []
        self.uma_events = []
        self.ura_finale_events = []
        self.load_databases()
        self.setup_overlay()
        self.last_event_name = None
        self.event_displayed = False
        self.event_detection_start = None

        self.left_screen_region = (0, 0, 1920//2, 1080)
        self.support_card_event_region = (240, 160, 200, 70)
        self.event_template = cv2.imread("assets/icons/event_choice_1.png")
        self.support_card_event_template = cv2.imread("assets/icons/support_card_event.png")
        self.tracked_support_event = []
        self.tracker_window = None
        self.tracker_button = None
        self.always_on_top = False

    def load_databases(self):
        print("Loading event databases...")
        if os.path.exists("assets/events/support_card.json"):
            with open("assets/events/support_card.json", "r", encoding="utf-8-sig") as f:
                self.support_events = json.load(f)
            print(f"   ✓ Loaded {len(self.support_events)} support card events")
        if os.path.exists("assets/events/uma_data.json"):
            with open("assets/events/uma_data.json", "r", encoding="utf-8-sig") as f:
                uma_data = json.load(f)
                for character in uma_data:
                    if "UmaEvents" in character:
                        self.uma_events.extend(character["UmaEvents"])
            print(f"   ✓ Loaded {len(self.uma_events)} uma events")
        if os.path.exists("assets/events/ura_finale.json"):
            with open("assets/events/ura_finale.json", "r", encoding="utf-8-sig") as f:
                self.ura_finale_events = json.load(f)
            print(f"   ✓ Loaded {len(self.ura_finale_events)} ura finale events")
        print("   ✓ Databases loaded successfully")

    def setup_overlay(self):
        self.root = tk.Tk()
        self.root.title("Event Overlay")
        self.root.geometry(f"{self.overlay_width}x{self.overlay_height}+{self.overlay_x}+{self.overlay_y}")
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', False)
        self.root.attributes('-alpha', 0.9)
        style = ttk.Style()
        style.theme_use('clam')
        self.main_frame = ttk.Frame(self.root, padding="10")
        self.main_frame.pack(fill=tk.BOTH, expand=True)
        self.title_label = ttk.Label(self.main_frame, text="🎮 Event Information", font=('Arial', 14, 'bold'), foreground='#2E86AB')
        self.title_label.pack(pady=(0, 10))
        self.event_name_label = ttk.Label(self.main_frame, text="Waiting for events...", font=('Arial', 12), foreground='#A23B72')
        self.event_name_label.pack(pady=(0, 10))
        self.options_text = tk.Text(self.main_frame, height=8, width=80, font=('Consolas', 10), wrap=tk.WORD, bg='#2C2C2C', fg='#FFFFFF', insertbackground='white', selectbackground='#404040')
        self.options_text.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        self.status_label = ttk.Label(self.main_frame, text="🔄 Monitoring for events...", font=('Arial', 10), foreground='#666666')
        self.status_label.pack()
        scrollbar = ttk.Scrollbar(self.main_frame, orient="vertical", command=self.options_text.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.options_text.configure(yscrollcommand=scrollbar.set)

        # Event Tracker button
        button_frame = ttk.Frame(self.main_frame)
        button_frame.pack(fill=tk.X)
        style.configure('Bold.TButton', font=('Arial', 12, 'bold'))
        self.tracker_button = ttk.Button(button_frame, text="Ʊ Tracker", style='Bold.TButton', command=self.toggle_tracker_window)
        self.tracker_button.pack(side=tk.LEFT)

        # Pushpin button
        style.configure('Pushpin.TButton', font=('Arial', 8))
        style.configure('Pushpin.Active.TButton', font=('Arial', 8, 'bold'))
        self.pushpin_button = ttk.Button(self.main_frame, text="📌", width=3, style='Pushpin.TButton', command=self.toggle_always_on_top)
        self.pushpin_button.place(relx=1.0, rely=0.0, anchor='ne')

        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.monitor_events()

    def toggle_always_on_top(self):
        """Toggle the always on top state"""
        self.always_on_top = not self.always_on_top

        if self.always_on_top:
            # Set to always on top
            self.root.attributes('-topmost', True)
            self.pushpin_button.config(text="📌", style='Pushpin.Active.TButton')  # 📍
        else:
            # Return to normal behavior
            self.root.attributes('-topmost', False)
            self.pushpin_button.config(text="📌", style='Pushpin.TButton')

    def toggle_tracker_window(self):
        """Toggle the event tracker window"""
        if self.tracker_window and self.tracker_window.winfo_exists():
            # If window exists, close it
            self.tracker_window.destroy()
            self.tracker_window = None
        else:
            # If window doesn't exist, create it
            self.create_tracker_window()

    def create_tracker_window(self):
        """Create the event tracker window"""
        self.tracker_window = tk.Toplevel(self.root)
        self.tracker_window.title("Event Tracker")
        self.tracker_window.geometry("400x300+950+478")
        self.tracker_window.attributes('-topmost', True)

        # Make sure to reset the button color when window is closed
        self.tracker_window.protocol("WM_DELETE_WINDOW", self.close_tracker_window)

        # Main frame
        tracker_frame = ttk.Frame(self.tracker_window, padding="10")
        tracker_frame.pack(fill=tk.BOTH, expand=True)

        # Title
        title_label = ttk.Label(tracker_frame, text="Ʊ Tracked Support Events", font=('Arial', 14, 'bold'))
        title_label.pack(pady=(0, 10))

        # Listbox with scrollbar for tracked events
        list_frame = ttk.Frame(tracker_frame)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))

        self.tracked_listbox = tk.Listbox(list_frame, font=('Arial', 10))
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.tracked_listbox.yview)
        self.tracked_listbox.configure(yscrollcommand=scrollbar.set)

        self.tracked_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Update the listbox with current events
        self.update_tracked_events_list()

        # Button frame
        button_frame = ttk.Frame(tracker_frame)
        button_frame.pack(fill=tk.X)

        # Clear button
        clear_button = ttk.Button(button_frame, text="Clear", command=self.clear_tracked_events)
        clear_button.pack(side=tk.LEFT, padx=(0, 10))

        # Close button
        close_button = ttk.Button(button_frame, text="Close", command=self.close_tracker_window)
        close_button.pack(side=tk.LEFT)

    def update_tracked_events_list(self):
        """Update the listbox with tracked events"""
        if hasattr(self, 'tracked_listbox') and self.tracker_window and self.tracker_window.winfo_exists():
            self.tracked_listbox.delete(0, tk.END)
            for event in self.tracked_support_event:
                self.tracked_listbox.insert(tk.END, event)

    def clear_tracked_events(self):
        """Clear all tracked events"""
        self.tracked_support_event.clear()
        self.update_tracked_events_list()

    def close_tracker_window(self):
        """Close the tracker window"""
        if self.tracker_window and self.tracker_window.winfo_exists():
            self.tracker_window.destroy()
        self.tracker_window = None

    def highlight_tracker_button(self, duration=2000):
        """Temporarily highlight the tracker button"""
        if self.tracker_button:
            # Store original style
            style = ttk.Style()
            original_background = style.configure('TButton', 'background')

            # Apply highlight
            style.configure('Highlight.TButton', background='#FFD700')
            self.tracker_button.configure(style='Highlight.TButton')

            # Reset after duration
            self.root.after(duration, lambda: self.tracker_button.configure(style='TButton'))

    def generate_event_variations(self, event_name):
        event_variations = [event_name]

        if 'l' in event_name:
            variation = l_pattern.sub('!', event_name)
            if variation != event_name and variation not in event_variations:
                event_variations.append(variation)
            variation2 = l_exclamation_pattern.sub(r'!\1', event_name)
            if variation2 != event_name and variation2 not in event_variations:
                event_variations.append(variation2)
        if '!' in event_name:
            variation = event_name.replace('!', 'l')
            if variation not in event_variations:
                event_variations.append(variation)
        if '%' in event_name:
            variation = event_name.replace('%', '☆')
            if variation not in event_variations:
                event_variations.append(variation)
        if '☆' in event_name:
            variation = event_name.replace('☆', '%')
            if variation not in event_variations:
                event_variations.append(variation)
        cleaned_variations = []
        for variation in event_variations:
            cleaned = double_exclamation_pattern.sub('!', variation)
            if cleaned not in event_variations and cleaned != variation:
                cleaned_variations.append(cleaned)
            # Add variation without trailing exclamation marks
            no_exclamation = trailing_exclamation_pattern.sub('', variation).strip()
            if no_exclamation not in event_variations and no_exclamation != variation and no_exclamation:
                cleaned_variations.append(no_exclamation)
            # Add variation without trailing single letters (OCR artifacts)
            no_trailing_letter = trailing_letter_pattern.sub('', variation).strip()
            if no_trailing_letter not in event_variations and no_trailing_letter != variation and no_trailing_letter:
                cleaned_variations.append(no_trailing_letter)
            no_trailing_letter2 = trailing_letter_pattern2.sub('', variation).strip()
            if no_trailing_letter2 not in event_variations and no_trailing_letter2 != variation and no_trailing_letter2:
                cleaned_variations.append(no_trailing_letter2)
        event_variations.extend(cleaned_variations)
        word_order_variations = []
        for variation in event_variations:
            words = variation.split()
            if len(words) >= 3:
                if len(words) == 3:
                    import itertools
                    for perm in itertools.permutations(words):
                        perm_text = ' '.join(perm)
                        if perm_text not in event_variations and perm_text != variation:
                            word_order_variations.append(perm_text)
                elif len(words) == 4:
                    first_half = ' '.join(words[:2])
                    second_half = ' '.join(words[2:])
                    swapped = f"{second_half} {first_half}"
                    if swapped not in event_variations and swapped != variation:
                        word_order_variations.append(swapped)
        event_variations.extend(word_order_variations)
        return event_variations

    def search_events(self, event_variations):
        found_events = {}
        for event in self.support_events:
            db_event_name = event.get("EventName", "").lower()
            clean_db_name = db_event_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
            for variation in event_variations:
                clean_search_name = variation.lower().strip()
                # Clean search name the same way as database names
                clean_search_name = clean_search_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
                if clean_db_name == clean_search_name:
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Support Card", "options": {}}
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
                elif self.fuzzy_match(clean_search_name, clean_db_name) or self.smart_substring_match(clean_search_name, clean_db_name):
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Support Card", "options": {}}
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
        for event in self.uma_events:
            db_event_name = event.get("EventName", "").lower()
            clean_db_name = db_event_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
            for variation in event_variations:
                clean_search_name = variation.lower().strip()
                # Clean search name the same way as database names
                clean_search_name = clean_search_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
                if clean_db_name == clean_search_name:
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Uma Data", "options": {}}
                    elif found_events[event_name_key]["source"] == "Support Card":
                        found_events[event_name_key]["source"] = "Both"
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
                elif self.fuzzy_match(clean_search_name, clean_db_name) or self.smart_substring_match(clean_search_name, clean_db_name):
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Uma Data", "options": {}}
                    elif found_events[event_name_key]["source"] == "Support Card":
                        found_events[event_name_key]["source"] = "Both"
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
        for event in self.ura_finale_events:
            db_event_name = event.get("EventName", "").lower()
            clean_db_name = db_event_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
            for variation in event_variations:
                clean_search_name = variation.lower().strip()
                # Clean search name the same way as database names
                clean_search_name = clean_search_name.replace("(❯)", "").replace("(❯❯)", "").replace("(❯❯❯)", "").strip()
                if clean_db_name == clean_search_name:
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Ura Finale", "options": {}}
                    elif found_events[event_name_key]["source"] in ["Support Card", "Uma Data"]:
                        found_events[event_name_key]["source"] = "Multiple Sources"
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
                elif self.fuzzy_match(clean_search_name, clean_db_name) or self.smart_substring_match(clean_search_name, clean_db_name):
                    event_name_key = event['EventName']
                    if event_name_key not in found_events:
                        found_events[event_name_key] = {"source": "Ura Finale", "options": {}}
                    elif found_events[event_name_key]["source"] in ["Support Card", "Uma Data"]:
                        found_events[event_name_key]["source"] = "Multiple Sources"
                    event_options = event.get("EventOptions", {})
                    for option_name, option_reward in event_options.items():
                        if option_name and any(keyword in option_name.lower() for keyword in ["top option", "bottom option", "middle option", "option1", "option2", "option3"]):
                            found_events[event_name_key]["options"][option_name] = option_reward
                    break
        return found_events

    def fuzzy_match(self, search_name, db_name):
        common_words = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']
        search_words = [word for word in search_name.split() if word not in common_words]
        db_words = [word for word in db_name.split() if word not in common_words]
        if len(search_words) >= 2 and len(db_words) >= 2:
            matches = sum(1 for word in search_words if word in db_words)
            match_ratio = matches / max(len(search_words), len(db_words))
            return match_ratio >= 0.7  # Increased fuzzy match threshold for more precision
        elif len(search_words) == 1 and len(db_words) == 1:
            search_word = search_words[0]
            db_word = db_words[0]
            return search_word in db_word or db_word in search_word
        return False

    def smart_substring_match(self, search_name, db_name):
        """Smart substring matching that prevents short words from matching longer phrases"""
        # If search name is too short, don't match
        if len(search_name) < 8:
            return False
        
        # If search name is a single word and db_name has multiple words, be more careful
        search_words = search_name.split()
        db_words = db_name.split()
        
        if len(search_words) == 1 and len(db_words) > 1:
            # Single word search in multi-word database entry - require longer words
            search_word = search_words[0]
            # Remove punctuation for length check
            clean_word = ''.join(c for c in search_word if c.isalnum())
            if len(clean_word) < 8:
                return False
            # Only match if the search word appears as a complete word in the database entry
            return search_word in db_words
        else:
            # Multi-word search or single-word database entry
            # Be more strict: only allow substring matching if the search name is significantly shorter
            # This prevents "Shrine Visit" from matching "New Year's Shrine Visit"
            if len(search_name) >= len(db_name) * 0.8:  # Search name must be at least 80% of db_name length
                return False
            return search_name in db_name or db_name in search_name

    def update_overlay(self, event_name, found_events):
        if found_events:
            event_name_key = list(found_events.keys())[0]
            self.event_name_label.config(text=f"📋 {event_name_key}")
            self.options_text.delete(1.0, tk.END)
            for event_name_key, event_data in found_events.items():
                self.options_text.insert(tk.END, f"📍 Source: {event_data['source']}\n")
                self.options_text.insert(tk.END, "🎯 Options:\n")
                options = event_data["options"]
                if options:
                    for option_name, option_reward in options.items():
                        reward_single_line = option_reward.replace("\r\n", ", ").replace("\n", ", ").replace("\r", ", ")
                        self.options_text.insert(tk.END, f"   {option_name}: {reward_single_line}\n")
                    option_count = len(options)
                    self.options_text.insert(tk.END, f"\n📊 Total options: {option_count}\n")
                else:
                    self.options_text.insert(tk.END, "   No valid options found\n")
            self.status_label.config(text="✅ Event found!", foreground='#28A745')
        else:
            self.event_name_label.config(text=f"❓ {event_name}")
            self.options_text.delete(1.0, tk.END)
            self.options_text.insert(tk.END, "❌ Unknown event - not found in database\n")
            self.options_text.insert(tk.END, f"Searched for: '{event_name}'\n")
            self.status_label.config(text="❌ Unknown event", foreground='#DC3545')

    def monitor_events(self):
        try:
            try:
                left_screenshot = capture_region(self.left_screen_region)
                left_cv_image = np.array(left_screenshot)[:, :, ::-1]
                event_icon = is_match_template(left_cv_image, self.event_template, threshold=0.8)

                support_screenshot = capture_region(self.support_card_event_region)
                support_cv_image = np.array(support_screenshot)[:, :, ::-1]
                support_card_event = is_match_template(support_cv_image, self.support_card_event_template, threshold=0.8)
            except ImageNotFoundException:
                event_icon = None
                support_card_event = None
            if event_icon or support_card_event:
                if not self.always_on_top:  # Only remove topmost if not in always-on-top mode
                    self.root.attributes('-topmost', True)
                self.root.lift()
                if self.event_detection_start is None:
                    self.event_detection_start = time.time()
                    if support_card_event:
                        self.status_label.config(text="👁️ Support event detected, waiting for stability...", foreground='#FFC107')
                    else:  # event_icon only
                        self.status_label.config(text="👁️ Event icon detected, waiting for stability...", foreground='#FFC107')
                if self.event_detection_start and not self.event_displayed:
                    time_present = time.time() - self.event_detection_start
                    if time_present >= 0.05:
                        self.status_label.config(text="✅ Processing event...", foreground='#17A2B8')
                        event_image = capture_region(self.event_region)
                        event_name = extract_event_name_text(event_image)
                        event_name = event_name.strip()

                        if support_card_event:
                            if event_name and event_name not in self.tracked_support_event and event_name != "A Hint for Growth":
                                event_variations = self.generate_event_variations(event_name)
                                found_events = self.search_events(event_variations)
                                if found_events:
                                    found_event_name = list(found_events.keys())[0]
                                    if found_event_name and found_event_name not in self.tracked_support_event:
                                        self.tracked_support_event.append(found_event_name)
                                        self.update_tracked_events_list()
                                        self.highlight_tracker_button()
                        if event_icon:
                            if event_name and event_name != self.last_event_name:
                                event_variations = self.generate_event_variations(event_name)
                                found_events = self.search_events(event_variations)
                                self.update_overlay(event_name, found_events)
                                self.last_event_name = event_name
                                self.event_displayed = True

                        self.event_detection_start = None
            elif not event_icon and not support_card_event:
                if not self.always_on_top:  # Only remove topmost if not in always-on-top mode
                    self.root.attributes('-topmost', False)
                if self.event_displayed:
                    self.event_displayed = False
                    self.last_event_name = None
                    self.status_label.config(text="🔄 Waiting for next event...", foreground='#6C757D')
                elif self.event_detection_start:
                    self.event_detection_start = None
                    self.status_label.config(text="❌ Event disappeared too quickly", foreground='#DC3545')

            self.root.after(500, self.monitor_events)
        except Exception as e:
            self.status_label.config(text=f"❌ Error: {str(e)}", foreground='#DC3545')
            self.root.after(500, self.monitor_events)

    def on_closing(self):
        print("🛑 Event overlay stopped by user")
        self.root.destroy()

    def run(self):
        print("🎮 Event Overlay Started")
        print(f"📍 Overlay position: ({self.overlay_x}, {self.overlay_y})")
        print(f"📏 Overlay size: {self.overlay_width}x{self.overlay_height}")
        print("Press Ctrl+C or close the overlay window to stop")
        print()
        try:
            self.root.mainloop()
        except KeyboardInterrupt:
            self.on_closing()

def main():
    overlay = EventOverlay()
    overlay.run()

if __name__ == "__main__":
    main()
