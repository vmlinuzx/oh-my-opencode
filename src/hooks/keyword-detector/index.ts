import type { PluginInput } from "@opencode-ai/plugin"
import { detectKeywordsWithType, extractPromptText, removeCodeBlocks } from "./detector"
import { log } from "../../shared"
import { getMainSessionID } from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export * from "./detector"
export * from "./constants"
export * from "./types"

export function createKeywordDetectorHook(
  ctx: PluginInput,
  collector?: ContextCollector,
  config?: OhMyOpenCodeConfig
) {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string;[key: string]: unknown }>
      }
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)
      let detectedKeywords = detectKeywordsWithType(
        removeCodeBlocks(promptText),
        input.agent,
        config?.keyword_modes
      )

      if (detectedKeywords.length === 0) {
        return
      }

      const mainSessionID = getMainSessionID()
      const isNonMainSession = mainSessionID && input.sessionID !== mainSessionID

      if (isNonMainSession) {
        // In non-main sessions, only allow ultrawork and custom modes
        detectedKeywords = detectedKeywords.filter(
          (k) => k.type === "ultrawork" || k.type === "custom"
        )
        if (detectedKeywords.length === 0) {
          log(`[keyword-detector] Skipping non-ultrawork keywords in non-main session`, {
            sessionID: input.sessionID,
            mainSessionID,
          })
          return
        }
      }

      const hasUltrawork = detectedKeywords.some((k) => k.type === "ultrawork")
      const hasCustom = detectedKeywords.some((k) => k.type === "custom")

      // Set max variant for ultrawork or custom modes
      if (hasUltrawork || hasCustom) {
        output.message.variant = "max"
      }

      if (hasUltrawork) {
        log(`[keyword-detector] Ultrawork mode activated`, { sessionID: input.sessionID })

        ctx.client.tui
          .showToast({
            body: {
              title: "Ultrawork Mode Activated",
              message: "Maximum precision engaged. All agents at your disposal.",
              variant: "success" as const,
              duration: 3000,
            },
          })
          .catch((err) =>
            log(`[keyword-detector] Failed to show toast`, { error: err, sessionID: input.sessionID })
          )
      }

      // Show toasts for custom modes
      for (const keyword of detectedKeywords) {
        if (keyword.type === "custom" && keyword.toast?.show !== false) {
          const toastTitle = keyword.toast?.title ?? `${keyword.customName} Mode Activated`
          const toastMessage = keyword.toast?.message ?? `Custom mode "${keyword.customName}" engaged.`

          log(`[keyword-detector] Custom mode activated: ${keyword.customName}`, {
            sessionID: input.sessionID,
          })

          ctx.client.tui
            .showToast({
              body: {
                title: toastTitle,
                message: toastMessage,
                variant: "success" as const,
                duration: 3000,
              },
            })
            .catch((err) =>
              log(`[keyword-detector] Failed to show custom toast`, {
                error: err,
                sessionID: input.sessionID,
                mode: keyword.customName,
              })
            )
        }
      }

      if (collector) {
        for (const keyword of detectedKeywords) {
          const id = keyword.type === "custom"
            ? `keyword-custom-${keyword.customName}`
            : `keyword-${keyword.type}`
          collector.register(input.sessionID, {
            id,
            source: "keyword-detector",
            content: keyword.message,
            priority: keyword.type === "ultrawork" || keyword.type === "custom" ? "critical" : "high",
          })
        }
      }

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type === "custom" ? `custom:${k.customName}` : k.type),
      })
    },
  }
}
