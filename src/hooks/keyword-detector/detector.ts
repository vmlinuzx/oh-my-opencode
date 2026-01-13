import {
  KEYWORD_DETECTORS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
} from "./constants"
import type { KeywordModeConfig } from "../../config/schema"
import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { resolve } from "path"

export interface DetectedKeyword {
  type: "ultrawork" | "search" | "analyze" | "custom"
  /** For custom modes, this is the mode name from config */
  customName?: string
  message: string
  /** Toast configuration for custom modes */
  toast?: {
    show: boolean
    title?: string
    message?: string
  }
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Resolves message to string, handling both static strings and dynamic functions.
 */
function resolveMessage(
  message: string | ((agentName?: string) => string),
  agentName?: string
): string {
  return typeof message === "function" ? message(agentName) : message
}

/**
 * Expands ~ to home directory in file paths.
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith("~")) {
    return resolve(homedir(), filePath.slice(2))
  }
  return resolve(filePath)
}

/**
 * Loads prompt from external file if specified.
 */
function loadPromptFromFile(promptFile: string): string | null {
  try {
    const expandedPath = expandPath(promptFile)
    if (existsSync(expandedPath)) {
      return readFileSync(expandedPath, "utf-8")
    }
    return null
  } catch {
    return null
  }
}

/**
 * Creates keyword detectors from custom config.
 */
export function createCustomKeywordDetectors(
  customModes: Record<string, KeywordModeConfig> | undefined
): Array<{
  name: string
  pattern: RegExp
  prompt: string
  showToast: boolean
  toastTitle?: string
  toastMessage?: string
}> {
  if (!customModes) return []

  return Object.entries(customModes)
    .map(([name, config]) => {
      // Get prompt from inline or file
      let prompt = config.prompt
      if (!prompt && config.prompt_file) {
        prompt = loadPromptFromFile(config.prompt_file) ?? undefined
      }

      if (!prompt) {
        // Skip modes without a valid prompt
        return null
      }

      try {
        return {
          name,
          pattern: new RegExp(config.pattern, "i"),
          prompt,
          showToast: config.show_toast ?? true,
          toastTitle: config.toast_title,
          toastMessage: config.toast_message,
        }
      } catch {
        // Invalid regex pattern, skip
        return null
      }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
}

export function detectKeywords(text: string, agentName?: string): string[] {
  const textWithoutCode = removeCodeBlocks(text)
  return KEYWORD_DETECTORS.filter(({ pattern }) =>
    pattern.test(textWithoutCode)
  ).map(({ message }) => resolveMessage(message, agentName))
}

/**
 * Detect keywords with type, including custom modes from config.
 */
export function detectKeywordsWithType(
  text: string,
  agentName?: string,
  customModes?: Record<string, KeywordModeConfig>
): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const types: Array<"ultrawork" | "search" | "analyze"> = ["ultrawork", "search", "analyze"]

  // Check built-in keyword detectors
  const builtinMatches = KEYWORD_DETECTORS.map(({ pattern, message }, index) => ({
    matches: pattern.test(textWithoutCode),
    type: types[index],
    message: resolveMessage(message, agentName),
  }))
    .filter((result) => result.matches)
    .map(({ type, message }) => ({ type, message }) as DetectedKeyword)

  // Check custom keyword modes from config
  const customDetectors = createCustomKeywordDetectors(customModes)
  const customMatches = customDetectors
    .filter(({ pattern }) => pattern.test(textWithoutCode))
    .map(({ name, prompt, showToast, toastTitle, toastMessage }) => ({
      type: "custom" as const,
      customName: name,
      message: prompt,
      toast: {
        show: showToast,
        title: toastTitle,
        message: toastMessage,
      },
    }))

  // Custom modes take priority (come first)
  return [...customMatches, ...builtinMatches]
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
}
