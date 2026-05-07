# Exam Prep (QUIZNOW)

A modern, interactive web-based MCQ quiz engine for exam preparation. Built with vanilla JavaScript, HTML, and CSS—no dependencies required.

## Features
- **Practice & Exam Modes:** Choose between instant feedback (practice) or timed exam simulation.
- **Configurable Timer:** Set a fixed duration or custom time for your quiz session.
- **Question Shuffling:** Randomize questions and/or options for each session.
- **Image Support:** Questions can include images (auto-detected if present).
- **Progress Tracking:** Visual progress bar, question navigator, and marking for review.
- **Persistence:** Quiz state is saved in your browser (localStorage) for session resumption.
- **Results & Review:** Animated score ring, detailed review panel, and answer breakdown.

## Project Structure
```
index.html         # Main HTML file
script.js          # Quiz engine logic (vanilla JS)
style.css          # Custom styles
images/            # Optional question images (named 1.png, 2.png, ...)
res/data.json      # Question bank (MCQs in JSON format)
```

## Getting Started
1. **Clone or Download** this repository.
2. **Add/Update Questions:**
   - Edit `res/data.json` to add or modify questions.
   - Each question supports text, options, and an answer index.
   - To add images, place PNG files in the `images/` folder (named by question number).
3. **Open `index.html`** in your browser. No build step required.

## Customization
- **Add More Questions:**
  - Follow the JSON structure in `res/data.json`.
- **Change Styles:**
  - Edit `style.css` for custom themes or layouts.
- **Add Images:**
  - Place images as `images/1.png`, `images/2.png`, etc. (auto-detected per question).

## Keyboard Shortcuts
- **← / →**: Navigate questions
- **1–9**: Select option
- **M**: Mark/unmark for review

## License
This project is open source and free to use for educational purposes.

---
Created by [Your Name].
