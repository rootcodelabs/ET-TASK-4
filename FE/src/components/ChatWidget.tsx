import { useState, useRef, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AudioLines, Mic, Maximize2, X, Volume2 } from "lucide-react"
import type { Message } from "@/types"
import { useSttStreaming } from "@/hooks/useSttStreaming"
import { chatService } from "@/services/chatService"
import pcmWorkletSource from "@/audio/pcmWorkletProcessor.js?raw"

const iconPng = "/assets/icon.png"
const blueIconPng = "/assets/icon-blue.png"

interface ChatWidgetProps {
  isOpen?: boolean
  onClose?: () => void
  isExpanded?: boolean
  onToggleExpand?: () => void
}

const VoiceWave = () => (
  <div className="flex items-center space-x-0.5 h-6 px-2">
    <style>
      {`
        @keyframes wave {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}
    </style>
    {[...Array(20)].map((_, i) => (
      <div
        key={i}
        className="w-1.5 h-1.5 bg-gray-500 rounded-full"
        style={{
          animation: "wave 1.2s ease-in-out infinite",
          animationDelay: `${i * 0.05}s`,
          marginRight: "2px",
        }}
      />
    ))}
  </div>
)

export function ChatWidget({
  isOpen = true,
  onClose,
  isExpanded,
  onToggleExpand,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hi, I'm your AI-based digital assistant",
      timestamp: new Date(),
    },
    {
      id: "2",
      role: "assistant",
      content: "Hello! You can ask me for advice on ID card software and electronic use.",
      timestamp: new Date(),
    },
    {
      id: "3",
      role: "assistant",
      content:
        "I am an artificial intelligence-based chatbot and I am still learning, be sure to check the information from the cited sources. How can I help?",
      timestamp: new Date(),
    },
  ])

  const [inputValue, setInputValue] = useState("")
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false)

  const [audioMode, setAudioMode] = useState<"batch" | "realtime">("batch")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isAnswering, setIsAnswering] = useState(false)
  const [isBatchRecording, setIsBatchRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const answeringRef = useRef(false)
  const pendingBatchRef = useRef<{ question: string; answer: string } | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const batchAudioContextRef = useRef<AudioContext | null>(null)
  const batchStreamRef = useRef<MediaStream | null>(null)
  const batchWorkletNodeRef = useRef<AudioWorkletNode | null>(null)
  const batchPcmChunksRef = useRef<Int16Array[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendUserMessage = useCallback(async (text: string) => {
    const trimmed = (text || "").trim()
    if (!trimmed) return

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }

    const thinkingId = `${Date.now()}_thinking`

    const thinkingMessage: Message = {
      id: thinkingId,
      role: "assistant",
      content: "Mõtlen...",
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, newMessage, thinkingMessage])

    const clientId =
      localStorage.getItem("burokratt_client_id") || `client_${Math.random().toString(36).slice(2, 11)}`
    localStorage.setItem("burokratt_client_id", clientId)

    try {
      const reply = await chatService.getAssistantReply(trimmed, clientId)
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: reply.text || "Vabandust, ma ei saanud vastust.",
        timestamp: new Date(),
      }
      setMessages((prev) => {
        const withoutThinking = prev.filter((msg) => msg.id !== thinkingId)
        return [...withoutThinking, aiResponse]
      })
    } catch (err) {
      console.error("LLM request failed:", err)
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Vabandust, vastuse saamine ebaõnnestus. Proovi uuesti.",
        timestamp: new Date(),
      }
      setMessages((prev) => {
        const withoutThinking = prev.filter((msg) => msg.id !== thinkingId)
        return [...withoutThinking, aiResponse]
      })
    }
  }, [])

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return
    const text = inputValue
    setInputValue("")
    sendUserMessage(text)
  }, [inputValue, sendUserMessage])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const notify = useCallback((message: string) => {
    console.error(message)
  }, [])

  const {
    start: startStreaming,
    stop: stopStreaming,
    isStreaming,
    isConnecting,
    isReady,
    error: streamError,
    partialText,
  } = useSttStreaming({
    language: "et-EE",
    clientId:
      localStorage.getItem("burokratt_client_id") ||
      `client_${Math.random().toString(36).slice(2, 11)}`,
    onPartial: (text) => {
      setLiveTranscript(text)
    },
    onFinalTranscript: (text) => {
      if (text) {
        setInputValue((prev) => (prev ? `${prev} ${text}` : text))
      }
    },
    onError: (message) => {
      notify(message)
    },
    onStopped: () => {
      setIsVoiceModalOpen(false)
      setLiveTranscript("")
    },
  })

  const createBatchSession = useCallback(async () => {
    const clientId =
      localStorage.getItem("burokratt_client_id") || `client_${Math.random().toString(36).slice(2, 11)}`
    localStorage.setItem("burokratt_client_id", clientId)

    const session = await chatService.createAudioSession(clientId)
    return session.session_id as string
  }, [])

  const closeVoiceUi = useCallback(() => {
    if (audioMode === "realtime") {
      stopStreaming()
    }

    if (isBatchRecording) {
      stopBatchRecording()
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    setIsVoiceModalOpen(false)
    setIsProcessing(false)
    setIsAnswering(false)
    setIsBatchRecording(false)
    setLiveTranscript("")
  }, [audioMode, isBatchRecording, stopStreaming])

  const buildWavBlob = (chunks: Int16Array[], sampleRate = 16000) => {
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const buffer = new ArrayBuffer(44 + totalLength * 2)
    const view = new DataView(buffer)

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeString(0, "RIFF")
    view.setUint32(4, 36 + totalLength * 2, true)
    writeString(8, "WAVE")
    writeString(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, "data")
    view.setUint32(40, totalLength * 2, true)

    let offset = 44
    chunks.forEach((chunk) => {
      for (let i = 0; i < chunk.length; i += 1) {
        view.setInt16(offset, chunk[i], true)
        offset += 2
      }
    })

    return new Blob([buffer], { type: "audio/wav" })
  }

  const cleanupBatchAudio = () => {
    try {
      if (batchWorkletNodeRef.current) {
        batchWorkletNodeRef.current.port.onmessage = null
        batchWorkletNodeRef.current.disconnect()
      }
    } catch {}

    try {
      if (batchStreamRef.current) {
        batchStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    } catch {}

    batchWorkletNodeRef.current = null
    batchStreamRef.current = null

    const ctx = batchAudioContextRef.current
    batchAudioContextRef.current = null
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {})
    }
  }

  const stopBatchRecording = useCallback(async () => {
    if (!isBatchRecording) return
    setIsBatchRecording(false)
    setIsProcessing(true)

    cleanupBatchAudio()

    try {
      const audioBlob = buildWavBlob(batchPcmChunksRef.current)
      batchPcmChunksRef.current = []
      const sId = await createBatchSession()
      const result = await chatService.transcribeBatch(sId, audioBlob)
      if (result.text) {
        setInputValue((prev) => (prev ? prev + " " : "") + result.text)

        const reply = await chatService.getAssistantReply(result.text)
        const replyText = reply.text || "Vabandust, ma ei saanud vastust."

        setIsAnswering(true)
        answeringRef.current = true
        pendingBatchRef.current = { question: result.text, answer: replyText }
        const audioData = await chatService.synthesizeSpeech(replyText)
        const blob = new Blob([audioData], { type: "audio/wav" })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setIsAnswering(false)
          answeringRef.current = false
          const pending = pendingBatchRef.current
          if (pending) {
            const userMsg: Message = {
              id: `${Date.now()}_q`,
              role: "user",
              content: pending.question,
              timestamp: new Date(),
            }
            const aiMsg: Message = {
              id: `${Date.now()}_a`,
              role: "assistant",
              content: pending.answer,
              timestamp: new Date(),
            }
            setMessages((prev) => [...prev, userMsg, aiMsg])
            pendingBatchRef.current = null
          }
          audioRef.current = null
          setIsVoiceModalOpen(false)
        }
        await audio.play()
      }
    } catch (err) {
      console.error("Batch transcription failed:", err)
      answeringRef.current = false
      setIsAnswering(false)
      setIsVoiceModalOpen(false)
    } finally {
      setIsProcessing(false)
    }
  }, [createBatchSession, isBatchRecording])

  const handleSpeak = useCallback(async (message: Message) => {
    if (message.role !== "assistant") return
    const text = (message.content || "").trim()
    if (!text) return

    if (playingMessageId === message.id) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingMessageId(null)
      return
    }

    try {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }

      const audioData = await chatService.synthesizeSpeech(text)
      const blob = new Blob([audioData], { type: "audio/wav" })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      setPlayingMessageId(message.id)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        setPlayingMessageId(null)
        audioRef.current = null
      }

      await audio.play()
    } catch (err) {
      console.error("TTS playback failed:", err)
      setPlayingMessageId(null)
    }
  }, [playingMessageId])

  const handleMicClick = useCallback(async () => {
    setAudioMode("batch")
    setIsVoiceModalOpen(true)
  }, [])

  const handleStreamClick = useCallback(async () => {
    setAudioMode("realtime")
    setIsVoiceModalOpen(true)

    try {
      await startStreaming()
    } catch (error) {
      console.error("Failed to start streaming:", error)
      setIsVoiceModalOpen(false)
    }
  }, [startStreaming])

  const startBatchRecording = useCallback(async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      batchStreamRef.current = stream
      batchPcmChunksRef.current = []

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      batchAudioContextRef.current = audioContext

      const workletBlob = new Blob([pcmWorkletSource], {
        type: "application/javascript",
      })
      const workletUrl = URL.createObjectURL(workletBlob)
      await audioContext.audioWorklet.addModule(workletUrl)
      URL.revokeObjectURL(workletUrl)

      const workletNode = new AudioWorkletNode(audioContext, "pcm16-processor")
      batchWorkletNodeRef.current = workletNode

      workletNode.port.onmessage = (ev) => {
        const data = new Int16Array(ev.data as ArrayBuffer)
        batchPcmChunksRef.current.push(data)
      }

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)

      const gain = audioContext.createGain()
      gain.gain.value = 0
      workletNode.connect(gain)
      gain.connect(audioContext.destination)

      setIsBatchRecording(true)
    } catch (err) {
      console.error("Failed to start batch recording:", err)
    }
  }, [])

  if (!isOpen) return null

  const showModalOverlay = isVoiceModalOpen && audioMode === "batch"
  const showFooterOverlay = isVoiceModalOpen && audioMode === "realtime"

  if (showModalOverlay) {
    return (
      <Card
        className={`flex flex-col transition-all shadow-2xl bg-white ${
          isExpanded
            ? "h-[100dvh] w-[100vw] rounded-none sm:h-[90vh] sm:w-[94vw] sm:rounded-2xl md:w-[90vw]"
            : "h-[100dvh] w-[100vw] rounded-none sm:h-[80vh] sm:w-[520px] sm:rounded-2xl md:h-[660px] md:w-[450px]"
        }`}
      >
        <CardHeader className="flex flex-row items-center justify-end space-y-0 pb-4 border-b">
          <Button variant="ghost" size="icon" onClick={closeVoiceUi} className="rounded-full h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col items-center justify-center py-8 px-4 overflow-hidden">
          {streamError && <p className="text-red-500 mb-4">{streamError}</p>}

          {audioMode === "batch" && !isBatchRecording && !isProcessing && !isAnswering && (
            <>
              <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ backgroundColor: "#0000F0" }}>
                <img src={iconPng} alt="Burokratt" className="w-14 h-14" />
              </div>

              <div className="flex flex-col items-center space-y-3 mt-8">
                <button
                  onClick={startBatchRecording}
                  className="w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-gray-100 hover:bg-gray-200"
                >
                  <Mic className="h-6 w-6 text-gray-600" />
                </button>
                <p className="text-sm text-gray-600">Click to Speak</p>
              </div>
            </>
          )}

          {isProcessing && !isAnswering && (
            <>
              <div className="relative flex items-center justify-center w-[70vw] h-[70vw] max-w-[360px] max-h-[360px]">
                <div className="absolute w-[58vw] h-[58vw] max-w-[300px] max-h-[300px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.10)" }}
                />
                <div className="absolute w-[46vw] h-[46vw] max-w-[240px] max-h-[240px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.14)" }}
                />
                <div className="absolute w-[34vw] h-[34vw] max-w-[180px] max-h-[180px] rounded-full"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.18)" }}
                />
                <div
                  className="absolute w-[22vw] h-[22vw] max-w-[120px] max-h-[120px] rounded-full"
                  style={{
                    border: "3px solid rgba(255, 165, 0, 0.32)",
                    backgroundColor: "transparent",
                  }}
                />
              </div>

              <p className="text-lg font-semibold mt-8 mb-4 text-center" style={{ color: "#FFA500" }}>
                Processing...
              </p>

              <Button
                type="button"
                variant="ghost"
                onClick={closeVoiceUi}
                className="p-0 rounded-full hover:bg-transparent"
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: "#F3F4F6",
                }}
                aria-label="Cancel"
              >
                <div className="relative flex items-center justify-center" style={{ width: 24, height: 24 }}>
                  <div
                    className="absolute rounded-full"
                    style={{
                      width: 24,
                      height: 24,
                      border: "2px solid #FFA500",
                      backgroundColor: "transparent",
                    }}
                  />
                  <div
                    className="relative"
                    style={{
                      width: 10,
                      height: 10,
                      backgroundColor: "#FFA500",
                      borderRadius: 2,
                    }}
                  />
                </div>
              </Button>

            </>
          )}

          {isAnswering && (
            <>
              <div className="relative flex items-center justify-center w-[70vw] h-[70vw] max-w-[360px] max-h-[360px]">
                <div className="absolute w-[70vw] h-[70vw] max-w-[360px] max-h-[360px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.06)" }}
                />
                <div className="absolute w-[58vw] h-[58vw] max-w-[300px] max-h-[300px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.10)" }}
                />
                <div className="absolute w-[46vw] h-[46vw] max-w-[240px] max-h-[240px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.14)" }}
                />
                <div className="absolute w-[34vw] h-[34vw] max-w-[180px] max-h-[180px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(255, 165, 0, 0.18)" }}
                />

                <div className="relative flex items-center justify-center rounded-full w-[28vw] h-[28vw] max-w-[140px] max-h-[140px]"
                  style={{ backgroundColor: "#FFA500" }}
                >
                  <Volume2 className="text-white w-[12vw] h-[12vw] max-w-[54px] max-h-[54px]" />
                </div>
              </div>

              <p className="text-lg font-semibold mt-6 mb-4 text-center" style={{ color: "#FFA500" }}>
                Answering
              </p>

              <div className="flex flex-col items-center space-y-3">
                <button
                  onClick={closeVoiceUi}
                  className="w-12 h-12 rounded-full flex items-center justify-center hover:opacity-90 transition-all shadow-lg"
                  style={{ backgroundColor: "#FFA500" }}
                >
                  <X className="h-6 w-6 text-white" />
                </button>
                <p className="text-sm text-gray-800 font-medium">Click to Interrupt</p>
              </div>
            </>
          )}

          {audioMode === "batch" && isBatchRecording && (
            <>
              <div className="relative flex items-center justify-center w-[70vw] h-[70vw] max-w-[360px] max-h-[360px]">
                <div className="absolute w-[60vw] h-[60vw] max-w-[310px] max-h-[310px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(0, 0, 240, 0.05)" }}
                />
                <div className="absolute w-[46vw] h-[46vw] max-w-[240px] max-h-[240px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(0, 0, 240, 0.07)" }}
                />
                <div className="absolute w-[30vw] h-[30vw] max-w-[160px] max-h-[160px] rounded-full animate-pulse"
                  style={{ backgroundColor: "rgba(0, 0, 240, 0.10)" }}
                />
                <div className="relative flex items-center justify-center rounded-full w-[20vw] h-[20vw] max-w-[100px] max-h-[100px]"
                  style={{ backgroundColor: "#0000F0" }}
                >
                  <Mic className="text-white w-[10vw] h-[10vw] max-w-[44px] max-h-[44px]" />
                </div>
              </div>

              <p className="text-lg font-semibold mt-8 mb-6 text-center" style={{ color: "#0000F0" }}>
                Listening
              </p>

              <div className="flex flex-col items-center space-y-3">
                <button
                  onClick={stopBatchRecording}
                  className="w-12 h-12 rounded-full flex items-center justify-center hover:opacity-90 transition-all"
                  style={{ backgroundColor: "#0000F0" }}
                >
                  <Mic className="h-5 w-5 text-white" />
                </button>
                <p className="text-sm text-gray-800 font-medium">Click to Generate Answer</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={`flex flex-col transition-all shadow-2xl ${
        isExpanded
          ? "h-[100dvh] w-[100vw] rounded-none sm:h-[90vh] sm:w-[94vw] sm:rounded-2xl md:w-[90vw]"
          : "h-[100dvh] w-[100vw] rounded-none sm:h-[80vh] sm:w-[520px] sm:rounded-2xl md:h-[660px] md:w-[450px]"
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center">
            <img src={blueIconPng} alt="Burokratt" className="w-8 h-8" />
          </div>
          <CardTitle className="text-lg font-semibold" style={{ color: "#0000F0" }}>
            BÜROKRATT
          </CardTitle>
        </div>

        <div className="flex items-center space-x-1">
          {onToggleExpand && (
            <Button variant="ghost" size="icon" onClick={onToggleExpand} className="rounded-full h-8 w-8">
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gray-50">
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-semibold text-gray-900">Hi, I'm your AI-based digital assistant</h2>
          <p className="text-sm text-gray-600 leading-relaxed">Hello! You can ask me for advice on ID card software and electronic use.</p>
          <p className="text-sm text-gray-600 leading-relaxed">
            I am an artificial intelligence-based chatbot and I am still learning, be sure to check the information from the cited sources. How can I help?
          </p>
        </div>

        {(messages.length > 3 || (audioMode === "realtime" && isVoiceModalOpen && liveTranscript)) && (
          <div className="space-y-3 mt-6">
            {messages.slice(3).map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w[80%] rounded-lg px-4 py-2 ${message.role === "user" ? "text-white border-0" : "bg-white text-gray-900 border"
                    }`}
                  style={message.role === "user" ? { backgroundColor: "#0000F0" } : {}}
                >
                  <p className="text-sm">{message.content}</p>
                  {message.role === "assistant" && message.content !== "Mõtlen..." && (
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => handleSpeak(message)}
                        className={`p-2 rounded-full ${playingMessageId === message.id ? "bg-gray-200" : "bg-gray-100"} hover:bg-gray-200`}
                        aria-label="Play response"
                      >
                        <Volume2 className="h-4 w-4 text-gray-700" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {audioMode === "realtime" && isVoiceModalOpen && liveTranscript && (
              <div className="flex justify-start">
                <div className="max-w[80%] rounded-lg px-4 py-2 bg-white text-gray-900 border">
                  <p className="text-sm">{liveTranscript}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </CardContent>

      <div className="p-4 border-t">
        {showFooterOverlay ? (
          <div className="flex items-center space-x-2 w-full">
            <div className="flex-1 bg-gray-50 rounded-full px-4 py-2 h-10 flex items-center overflow-hidden">
              <div className="flex items-center space-x-2 w-full">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                <p className="text-sm text-blue-600 font-medium">
                  {isConnecting ? "Mikrofon käivitub..." : isReady || isStreaming ? "Kuulan..." : "Valmis"}
                </p>
                {partialText ? (
                  <p className="text-sm text-gray-500 truncate">- {partialText}</p>
                ) : (
                  <VoiceWave />
                )}
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => closeVoiceUi()}
              className="shrink-0 rounded-full h-10 w-10 bg-gray-100 hover:bg-gray-200"
            >
              <X className="h-5 w-5 text-gray-600" />
            </Button>

            {isStreaming || isConnecting || isReady ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => closeVoiceUi()}
                className="shrink-0 rounded-full h-10 w-10 bg-red-100 hover:bg-red-200"
              >
                <div className="w-3 h-3 bg-red-600 rounded-sm"></div>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const text = (partialText || "").trim()
                  closeVoiceUi()
                  if (text) sendUserMessage(text)
                }}
                className="shrink-0 rounded-full h-10 w-10 bg-gray-100 hover:bg-gray-200"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 text-gray-600"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Ask Bürokratt by typing or speaking..."
              value={inputValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress as any}
              className="flex-1 rounded-full border-gray-300"
            />

            <Button variant="ghost" size="icon" onClick={handleMicClick} className="shrink-0 rounded-full h-10 w-10 bg-gray-100 hover:bg-gray-200">
              <Mic className="h-5 w-5 text-gray-600" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={inputValue.trim() ? handleSend : handleStreamClick}
              className="shrink-0 rounded-full h-10 w-10 bg-gray-100 hover:bg-gray-200"
              title={inputValue.trim() ? "Send" : "Real-time Streaming"}
            >
              {inputValue.trim() ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 text-gray-600"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              ) : (
                <AudioLines className="h-5 w-5 text-gray-600" />
              )}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
