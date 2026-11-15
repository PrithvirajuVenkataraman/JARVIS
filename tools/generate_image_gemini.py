"""
Google GenAI Image Generation Script (Gemini 3.1 Flash Lite Image)
Uses the official google-genai SDK Interactions API.
"""
import base64
import os
import sys

def generate_image(prompt: str, output_path: str = "generated_image.png"):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    from google import genai

    client = genai.Client(
        api_key=api_key,
    )

    generation_config = {
        'temperature': 1,
        'max_output_tokens': 65536,
        'top_p': 0.95,
        'thinking_level': 'minimal',
        'image_config': {
            'image_size': '1K',
        },
    }

    print(f"Generating image with model 'models/gemini-3.1-flash-lite-image' for prompt: '{prompt}'...")
    interaction = client.interactions.create(
        model='models/gemini-3.1-flash-lite-image',
        input=prompt,
        generation_config=generation_config,
        response_modalities=['image', 'text'],
    )

    image_saved = False
    for step in interaction.steps:
        if step.type == 'model_output' and step.content:
            for part in step.content:
                if part.type == 'text':
                    print(part.text)
                elif part.type == 'image':
                    image_bytes = base64.b64decode(part.data)
                    with open(output_path, "wb") as f:
                        f.write(image_bytes)
                    print(f"Image successfully saved to: {output_path}")
                    image_saved = True

    if not image_saved:
        print("Warning: No image output returned in interaction steps.")

if __name__ == "__main__":
    input_prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "A futuristic cyberpunk city with neon lights at dusk"
    generate_image(input_prompt)
