/**
 * Ready-made workflows. Provider/model fields are placeholders: when a workflow is created
 * from a template they are replaced with the user's usable providers (see applyDefaults).
 */
import type { Step, WorkflowTemplate } from '@shared/automation'

const SAFE = { spendingCapUsd: 1, maxRunsPerHour: 30 }

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'blog-post',
    name: 'Blog post plus cover image',
    description:
      'Writes an outline and a full Markdown blog post about a topic, then generates a matching cover image.',
    howTo:
      'Click Run and type the topic as the input. The post is saved in your output folder under automation/blog.',
    workflow: {
      name: 'Blog post plus cover image',
      trigger: { type: 'manual' },
      safety: SAFE,
      steps: [
        {
          id: 'outline',
          name: 'Outline',
          type: 'llm',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          prompt:
            'Write a clear outline (title, 5–7 sections with bullet points) for a blog post about:\n\n{{input}}'
        },
        {
          id: 'post',
          name: 'Write the post',
          type: 'llm',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt:
            'You are a professional blog writer. Write in a friendly, clear style with short paragraphs and Markdown headings.',
          prompt:
            'Write the complete blog post (800–1200 words) in Markdown from this outline:\n\n{{outline.output}}'
        },
        {
          id: 'coverPrompt',
          name: 'Cover image prompt',
          type: 'llm',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          prompt:
            'Write ONE detailed prompt for an image generator to create a cover image for this blog post. No text in the image. Reply with only the prompt.\n\n{{post.output}}'
        },
        {
          id: 'cover',
          name: 'Cover image',
          type: 'image',
          providerId: 'openai',
          model: 'dall-e-3',
          prompt: '{{coverPrompt.output}}',
          size: '1792x1024',
          count: 1
        },
        {
          id: 'save',
          name: 'Save the post',
          type: 'writeFile',
          path: 'blog/{{datetime}}.md',
          content: '{{post.output}}\n\n![Cover image]({{cover.output}})\n'
        }
      ]
    }
  },
  {
    id: 'bulk-images-csv',
    name: 'Bulk image generation from CSV',
    description: 'Generates one image per row of a CSV file (or per line of a TXT file).',
    howTo:
      'Go to Automation › Batch, choose this workflow and a CSV with a "prompt" column (or a TXT file with one prompt per line). Each row becomes {{input}}.',
    workflow: {
      name: 'Bulk image generation',
      trigger: { type: 'manual' },
      safety: { spendingCapUsd: 5, maxRunsPerHour: 0 },
      steps: [
        {
          id: 'image',
          name: 'Generate image',
          type: 'image',
          providerId: 'openai',
          model: 'dall-e-3',
          prompt: '{{input}}',
          size: '1024x1024',
          count: 1
        }
      ]
    }
  },
  {
    id: 'transcribe-folder',
    name: 'Transcribe a folder of audio files',
    description: 'Watches a folder and transcribes every new audio file to a .txt file.',
    howTo:
      'Choose the folder to watch in the trigger and enable the workflow. New .mp3/.wav/.m4a files are transcribed into automation/transcripts. To transcribe files already in the folder, start a Batch with source "Folder".',
    workflow: {
      name: 'Transcribe audio folder',
      trigger: { type: 'folder', folder: '', pattern: '*.mp3;*.wav;*.m4a;*.ogg;*.webm;*.flac' },
      safety: { spendingCapUsd: 2, maxRunsPerHour: 60 },
      steps: [
        {
          id: 'transcript',
          name: 'Transcribe',
          type: 'stt',
          providerId: 'openai',
          model: 'whisper-1',
          filePath: '{{trigger.file}}'
        },
        {
          id: 'save',
          name: 'Save transcript',
          type: 'writeFile',
          path: 'transcripts/{{trigger.fileName}}.txt',
          content: '{{transcript.output}}'
        }
      ]
    }
  },
  {
    id: 'translate-files',
    name: 'Translate text files',
    description: 'Translates each text file in a folder and saves the translation.',
    howTo:
      'Edit the target language in the "Translate" step, then start a Batch with source "Folder" and pattern *.txt;*.md. Translations are saved in automation/translations.',
    workflow: {
      name: 'Translate text files',
      trigger: { type: 'manual' },
      safety: { spendingCapUsd: 2, maxRunsPerHour: 0 },
      steps: [
        { id: 'source', name: 'Read file', type: 'readFile', path: '{{trigger.file}}' },
        {
          id: 'translate',
          name: 'Translate',
          type: 'llm',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt:
            'You are a professional translator. Keep the formatting (Markdown, line breaks, lists). Reply with only the translation.',
          prompt: 'Translate the following text into Urdu:\n\n{{source.output}}'
        },
        {
          id: 'save',
          name: 'Save translation',
          type: 'writeFile',
          path: 'translations/{{trigger.fileName}}',
          content: '{{translate.output}}'
        }
      ]
    }
  },
  {
    id: 'daily-summary',
    name: 'Daily summary of a text file',
    description: 'Every day, summarises a notes/log file and saves the summary.',
    howTo:
      'Set the file to summarise in the "Read file" step (relative paths are inside your output folder’s automation folder), choose the time in the trigger and enable the workflow. Keep AI Hub running (or in the tray).',
    workflow: {
      name: 'Daily summary',
      trigger: { type: 'schedule', preset: 'daily', time: '18:00' },
      safety: { spendingCapUsd: 0.5, maxRunsPerHour: 2 },
      steps: [
        { id: 'notes', name: 'Read file', type: 'readFile', path: 'notes.txt' },
        {
          id: 'empty',
          name: 'Anything to summarise?',
          type: 'condition',
          left: '{{notes.output}}',
          operator: 'isEmpty',
          ifTrue: { action: 'stop' },
          ifFalse: { action: 'next' }
        },
        {
          id: 'summary',
          name: 'Summarise',
          type: 'llm',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          prompt:
            'Summarise the following notes for {{date}} in 5–10 bullet points, then list any action items:\n\n{{notes.output}}'
        },
        {
          id: 'save',
          name: 'Save summary',
          type: 'writeFile',
          path: 'summaries/{{date}}.md',
          content: '# Summary {{date}}\n\n{{summary.output}}\n'
        }
      ]
    }
  }
]

export type DefaultModels = Partial<
  Record<
    'llm' | 'image' | 'video' | 'tts' | 'stt',
    { providerId: string; model: string; voice?: string }
  >
>

/** Replace template placeholders with the user's providers, recursively. */
export function applyDefaults(steps: Step[], defaults: DefaultModels): Step[] {
  return steps.map((s) => {
    if (s.type === 'loop') return { ...s, steps: applyDefaults(s.steps, defaults) }
    if (s.type === 'llm' || s.type === 'image' || s.type === 'video' || s.type === 'stt') {
      const d = defaults[s.type]
      return d ? { ...s, providerId: d.providerId, model: d.model } : s
    }
    if (s.type === 'tts') {
      const d = defaults.tts
      return d ? { ...s, providerId: d.providerId, model: d.model, voice: d.voice ?? s.voice } : s
    }
    return s
  })
}
