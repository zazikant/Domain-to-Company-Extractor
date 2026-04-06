'use client';

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Building2,
  Search,
  Shield,
  Globe,
  Key,
  Mail,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Database,
  Brain,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Zap,
  FileText,
  MapPin,
  Phone,
  RefreshCw,
  Upload,
  X,
  Table2,
  Pause,
  Play,
  Download,
} from 'lucide-react';

interface ExtractResult {
  company: {
    name: string;
    confirmedName: string;
    companyType: string;
    realEstate: string;
    infrastructure: string;
    industrial: string;
  };
  description: string;
  location: string;
  contactEmail: string;
  contactPhone: string;
  confidence: number;
  partial: boolean;
  cached: boolean;
  cacheDiagnostic?: {
    convexUrl: string;
    convexStatus: string;
    convexMs: number;
    sqliteStatus: string;
    sqliteMs: number;
    sqliteDetail?: string;
  };
  domain?: string;
  discoveredDomain?: string;
  pipelineInfo?: {
    scrapingDomain: string;
    scrapedBytes: number;
    usedGLM: boolean;
    classificationSource: string;
    pipelineMs: number;
  };
  buildTime?: string;
}

interface ExtractError {
  error: string;
  source?: string;
  message: string;
}

interface BatchRow {
  id: string;
 email: string;
  domain: string;
  status: string;
  company_name: string;
  confirmed_name: string;
  company_type: string;
  real_estate: string;
  infrastructure: string;
  industrial: string;
  description: string;
  location: string;
  contact_email: string;
  contact_phone: string;
  confidence: number;
  partial: boolean;
  error_message: string;
  created_at: string;
}

interface BatchStatus {
  batchId: string;
  total: number;
  completed: number;
  errors: number;
  processing: number;
  pending: number;
  rows: BatchRow[];
}

const DEFAULT_UPSTASH_URL = process.env.NEXT_PUBLIC_UPSTASH_URL || '';
const DEFAULT_UPSTASH_TOKEN = process.env.NEXT_PUBLIC_UPSTASH_TOKEN || '';
const DEFAULT_SERPER_KEY = process.env.NEXT_PUBLIC_SERPER_KEY || '';
const DEFAULT_BROWSERLESS_TOKEN = process.env.NEXT_PUBLIC_BROWSERLESS_TOKEN || '';
const DEFAULT_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || '';
const DEFAULT_CONVEX_KEY = process.env.NEXT_PUBLIC_CONVEX_KEY || '';
const DEFAULT_OPENROUTER_KEY = process.env.NEXT_PUBLIC_OPENROUTER_KEY || '';
const DEFAULT_NVIDIA_KEY = process.env.NEXT_PUBLIC_NVIDIA_KEY || '';

/* ── Timer hook isolated so parent doesn't re-render every second ── */
function useElapsedTime() {
  const [sec, setSec] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const start = useCallback(() => {
    setSec(0);
    startRef.current = Date.now();
    const tick = () => {
      if (startRef.current !== null) {
        setSec(Math.floor((Date.now() - startRef.current) / 1000));
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    startRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);
  return { sec, start, stop };
}

/* ── Loading indicator — self-contained, no parent re-renders ── */
const LoadingIndicator = memo(function LoadingIndicator() {
  const { sec } = useElapsedTime();
  return (
    <Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 animate-in fade-in duration-300">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
            <Brain className="w-4 h-4 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              {sec < 5 ? 'Searching for company information...' :
               sec < 15 ? 'Scraping the company website...' :
               sec < 30 ? 'AI is analyzing all gathered data...' :
               'AI is still working — generating quality results...'}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                {sec >= 2 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                <span className={sec >= 2 ? 'text-emerald-700' : 'text-gray-500'}>Smart search (Serper)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {sec >= 5 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : sec >= 2 ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />}
                <span className={sec >= 5 ? 'text-emerald-700' : 'text-gray-500'}>Website scraping (Browserless)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {sec >= 8 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : sec >= 5 ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />}
                <span className={sec >= 8 ? 'text-emerald-700' : sec >= 5 ? 'text-blue-700 font-medium' : 'text-gray-500'}>AI classification & summary (GLM)</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Elapsed: {sec}s — AI analysis may take up to 60s for quality results
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

/* ── Loading button — self-contained timer ── */
const LoadingButton = memo(function LoadingButton() {
  const { sec, start, stop } = useElapsedTime();

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  return (
    <>
      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      {sec < 5 ? 'Searching...' : sec < 15 ? 'Scraping website...' : 'AI is analyzing...'}
      {sec >= 5 && (
        <span className="ml-1.5 text-xs opacity-70">({sec}s)</span>
      )}
    </>
  );
});

const STORAGE_KEY = 'company-extractor-api-keys';

function loadSavedKeys(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveKeysToStorage(keys: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch {}
}

export default function Home() {
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [serperKey, setSerperKey] = useState(DEFAULT_SERPER_KEY);
  const [browserlessToken, setBrowserlessToken] = useState(DEFAULT_BROWSERLESS_TOKEN);
  const [convexUrl, setConvexUrl] = useState(DEFAULT_CONVEX_URL);
  const [convexKey, setConvexKey] = useState(DEFAULT_CONVEX_KEY);
  const [openrouterKey, setOpenrouterKey] = useState(DEFAULT_OPENROUTER_KEY);
  const [llmModel, setLlmModel] = useState<'openrouter' | 'nvidia'>('nvidia');
  const [nvidiaApiKey, setNvidiaApiKey] = useState(DEFAULT_NVIDIA_KEY);
  const [nvidiaModel, setNvidiaModel] = useState('openai/gpt-oss-120b');
  const [upstashUrl, setUpstashUrl] = useState(DEFAULT_UPSTASH_URL);
  const [upstashToken, setUpstashToken] = useState(DEFAULT_UPSTASH_TOKEN);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<ExtractError | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [showConvex, setShowConvex] = useState(false);
  const [showRedis, setShowRedis] = useState(false);
  const [saveToast, setSaveToast] = useState(false);

  // Batch state
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchPaused, setBatchPaused] = useState(false);
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchError, setBatchError] = useState<string>('');
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchProcessRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadLimit, setDownloadLimit] = useState('');
  const [downloading, setDownloading] = useState(false);

  // Load saved keys from localStorage on mount
  useEffect(() => {
    const saved = loadSavedKeys();
    if (saved) {
      if (saved.serperKey) setSerperKey(saved.serperKey);
      if (saved.browserlessToken) setBrowserlessToken(saved.browserlessToken);
      if (saved.convexUrl) setConvexUrl(saved.convexUrl);
      if (saved.convexKey) setConvexKey(saved.convexKey);
      if (saved.openrouterKey) setOpenrouterKey(saved.openrouterKey);
      if (saved.llmModel) setLlmModel(saved.llmModel as 'openrouter' | 'nvidia');
      if (saved.nvidiaApiKey) setNvidiaApiKey(saved.nvidiaApiKey);
      if (saved.nvidiaModel) setNvidiaModel(saved.nvidiaModel);
      if (saved.upstashUrl) setUpstashUrl(saved.upstashUrl);
      if (saved.upstashToken) setUpstashToken(saved.upstashToken);
    }
    setKeysLoaded(true);
  }, []);

  const handleSaveKeys = useCallback(() => {
    saveKeysToStorage({
      serperKey, browserlessToken, convexUrl, convexKey,
      openrouterKey, llmModel, nvidiaApiKey, nvidiaModel,
      upstashUrl, upstashToken,
    });
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  }, [serperKey, browserlessToken, convexUrl, convexKey, openrouterKey, llmModel, nvidiaApiKey, nvidiaModel, upstashUrl, upstashToken]);

  const handleExtract = useCallback(async (forceRefresh = false, customEmail?: string) => {
    const emailToUse = customEmail || email;
    if (!emailToUse.trim() || !emailToUse.includes('@')) {
      setError({ error: 'invalid_email', message: 'Please enter a valid email address.' });
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/company-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Serper-Api-Key': serperKey.trim(),
          'X-Browserless-Token': browserlessToken.trim(),
          'X-Convex-Api-Key': convexKey.trim(),
          'X-Convex-Url': convexUrl.trim(),
          'X-Upstash-Redis-Url': upstashUrl.trim(),
          'X-Upstash-Redis-Token': upstashToken.trim(),
          ...(openrouterKey.trim() ? { 'X-Openrouter-Api-Key': openrouterKey.trim() } : {}),
          'X-LLM-Model': llmModel,
          ...(llmModel === 'nvidia' && nvidiaApiKey.trim() ? { 'X-Nvidia-Api-Key': nvidiaApiKey.trim() } : {}),
          ...(llmModel === 'nvidia' && nvidiaModel.trim() ? { 'X-Nvidia-Model': nvidiaModel.trim() } : {}),
          ...(forceRefresh ? { 'X-Force-Refresh': 'true' } : {}),
        },
        body: JSON.stringify({ email: emailToUse.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data as ExtractError);
        return;
      }

      setResult(data as ExtractResult);
    } catch {
      setError({ error: 'internal_error', message: 'Network error. Please check your connection and try again.' });
    } finally {
      setLoading(false);
    }
  }, [email, serperKey, browserlessToken, convexKey, convexUrl, openrouterKey, upstashUrl, upstashToken, llmModel, nvidiaApiKey, nvidiaModel]);

  const handleForceRefresh = useCallback(async (customEmail?: string) => {
    const emailToUse = customEmail || email;
    await handleExtract(true, emailToUse);
  }, [handleExtract, email]);

  // ── Batch Upload Handler ──
  const handleBatchUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchUploading(true);
    setBatchError('');
    setBatchStatus(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/batch/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setBatchError(data.error || 'Upload failed');
        return;
      }

      setBatchId(data.batchId);
      setBatchProcessing(true);
      setBatchPaused(false);
      setBatchStatus(prev => prev ? null : null);
    } catch {
      setBatchError('Network error during upload');
    } finally {
      setBatchUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  // ── Batch Process Loop ──
  const processNextRow = useCallback(async () => {
    if (!batchId || batchPaused) return;

    try {
      const res = await fetch('/api/batch/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          apiKey: serperKey.trim(),
          browserlessToken: browserlessToken.trim(),
          llmModel,
          nvidiaApiKey: nvidiaApiKey.trim(),
          nvidiaModel: nvidiaModel.trim(),
          openrouterKey: openrouterKey.trim(),
          convexUrl: convexUrl.trim(),
        }),
      });
      const data = await res.json();

      if (data.done) {
        setBatchProcessing(false);
        batchProcessRef.current = false;
        return;
      }
    } catch {
      // Network error — retry after delay
    }
  }, [batchId, batchPaused, serperKey, browserlessToken, llmModel, nvidiaApiKey, nvidiaModel, openrouterKey, convexUrl]);

  // Start/stop batch processing loop
  useEffect(() => {
    if (batchProcessing && !batchPaused && batchId) {
      batchProcessRef.current = true;
      const interval = setInterval(() => {
        if (batchProcessRef.current) {
          processNextRow();
        }
      }, 3000); // Process one row every 3 seconds

      batchPollRef.current = interval;
      return () => clearInterval(interval);
    } else {
      if (batchPollRef.current) {
        clearInterval(batchPollRef.current);
        batchPollRef.current = null;
      }
    }
  }, [batchProcessing, batchPaused, batchId, processNextRow]);

  // Poll batch status
  useEffect(() => {
    if (!batchId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/batch/status?batchId=${batchId}`);
        const data = await res.json();
        if (res.ok) setBatchStatus(data);
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [batchId]);

  const handleBatchPause = useCallback(() => {
    setBatchPaused(p => !p);
  }, []);

  const handleBatchCancel = useCallback(async () => {
    if (!batchId) return;
    setBatchProcessing(false);
    setBatchPaused(true);
    batchProcessRef.current = false;
    try {
      await fetch('/api/batch/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });
    } catch {}
  }, [batchId]);

  // ── Download Blank Template ──
  const downloadTemplate = useCallback(() => {
    const csv = 'email\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-email-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Download Results from Supabase ──
  const downloadResults = useCallback(async () => {
    if (!batchId) return;
    const limit = downloadLimit.trim() ? parseInt(downloadLimit.trim(), 10) : 0;
    if (isNaN(limit) && downloadLimit.trim() !== '') {
      setBatchError('Please enter a valid number for download limit');
      return;
    }
    setDownloading(true);
    try {
      const params = new URLSearchParams({ batchId });
      if (limit > 0) params.set('limit', String(limit));
      const res = await fetch(`/api/batch/download?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setBatchError(data.error || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename from Content-Disposition or generate one
      const disposition = res.headers.get('Content-Disposition');
      const filename = disposition?.match(/filename="(.+)"/)?.[1] || `batch-results-${batchId.slice(0, 8)}.csv`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setBatchError('Network error during download');
    } finally {
      setDownloading(false);
    }
  }, [batchId, downloadLimit]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-emerald-600';
    if (confidence >= 0.6) return 'text-amber-600';
    return 'text-red-500';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return 'Very High';
    if (confidence >= 0.7) return 'High';
    if (confidence >= 0.5) return 'Medium';
    if (confidence >= 0.3) return 'Low';
    return 'Very Low';
  };

  const getRoleTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      'Developer': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      'Contractor': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      'Consultant': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
      "Can't Say": 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-300',
    };
    return colors[type] || colors["Can't Say"];
  };

  const getSectorBadgeColor = (value: string) => {
    if (value === "Can't Say") return 'bg-gray-100 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400';
    const colors: Record<string, string> = {
      'Commercial': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      'Residential': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      'Data Center': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
      'Educational': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      'Hospitality': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      'Airport': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
      'Bridges': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      'Hydro': 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
      'Highway': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      'Marine': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      'Power': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
      'Railways': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
      'Aerospace': 'bg-slate-100 text-slate-700 dark:bg-slate-800/30 dark:text-slate-300',
      'Warehouse': 'bg-stone-100 text-stone-700 dark:bg-stone-800/30 dark:text-stone-300',
    };
    return colors[value] || 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-300';
  };

  const renderSectorBadges = (value: string) => {
    if (!value || value === "Can't Say") {
      return <span className="text-xs text-gray-400 italic">Can't Say</span>;
    }
    return value.split(',').map((v, i) => (
      <Badge key={i} className={`text-xs px-2 py-0.5 mr-1 mb-1 ${getSectorBadgeColor(v.trim())}`}>
        {v.trim()}
      </Badge>
    ));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-gray-900">
              Company Information Extractor
            </h1>
            <p className="text-xs text-gray-500">
              Extract company profiles from email addresses
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Intro Section */}
        <div className="text-center space-y-3 py-6">
          <div className="relative w-24 h-24 mx-auto">
            <Image
              src="/hero-icon.png"
              alt="Company extraction"
              width={96}
              height={96}
              className="rounded-2xl shadow-lg"
            />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Discover Company Information
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm sm:text-base">
            Enter any email address and our AI-powered pipeline will research the company,
            scrape its website, classify its sector, and write a professional summary.
            Results take 10-30 seconds for quality output.
          </p>
        </div>

        {/* Pipeline Steps Visual */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Mail, label: 'Email Input', step: '1' },
            { icon: Search, label: 'Smart Search', step: '2' },
            { icon: Globe, label: 'Domain Discovery', step: '3' },
            { icon: Brain, label: 'AI Classification', step: '4' },
          ].map(({ icon: Icon, label, step }) => (
            <div
              key={step}
              className="flex items-center gap-2.5 p-3 rounded-lg border bg-card text-card-foreground"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex-shrink-0">
                {step}
              </div>
              <Icon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-xs font-medium truncate">{label}</span>
            </div>
          ))}
        </div>

        {/* API Keys Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-600" />
              API Configuration
            </CardTitle>
            <CardDescription>
              Provide your API keys to enable the extraction pipeline. Keys are sent directly with each request and are not stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serper-key" className="text-sm font-medium">
                Serper.dev API Key <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="serper-key"
                  type={showKeys ? 'text' : 'password'}
                  placeholder="Enter your Serper.dev API key"
                  value={serperKey}
                  onChange={(e) => setSerperKey(e.target.value)}
                  className="pl-9 pr-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="browserless-token" className="text-sm font-medium">
                Browserless.io Token <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="browserless-token"
                  type={showKeys ? 'text' : 'password'}
                  placeholder="Enter your Browserless.io token"
                  value={browserlessToken}
                  onChange={(e) => setBrowserlessToken(e.target.value)}
                  className="pl-9 pr-10"
                />
              </div>
            </div>

            {/* Cloud Cache (Convex) toggle */}
            <button
              type="button"
              onClick={() => setShowConvex(!showConvex)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${showConvex ? 'rotate-90' : ''}`} />
              Cloud Cache: Convex (30-day persistent storage)
            </button>

            {showConvex && (
              <div className="space-y-4 pt-1 border-l-2 border-blue-200 pl-4">
                <div className="space-y-2">
                  <Label htmlFor="convex-url" className="text-sm font-medium">
                    Convex Deployment URL
                  </Label>
                  <div className="relative">
                    <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="convex-url"
                      type={showKeys ? 'text' : 'password'}
                      placeholder="https://your-project.convex.cloud"
                      value={convexUrl}
                      onChange={(e) => setConvexUrl(e.target.value)}
                      className="pl-9 pr-10"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                  <span>Results cached for 7 days (partial) or 30 days (complete). Falls back to local SQLite if Convex is unavailable.</span>
                </div>
              </div>
            )}

            {/* Rate Limiting (Upstash Redis) toggle */}
            <button
              type="button"
              onClick={() => setShowRedis(!showRedis)}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${showRedis ? 'rotate-90' : ''}`} />
              Rate Limiting: Upstash Redis
            </button>

            {showRedis && (
              <div className="space-y-4 pt-1 border-l-2 border-emerald-200 pl-4">
                <div className="space-y-2">
                  <Label htmlFor="upstash-url" className="text-sm font-medium">
                    Upstash Redis REST URL
                  </Label>
                  <div className="relative">
                    <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="upstash-url"
                      type={showKeys ? 'text' : 'password'}
                      placeholder="https://your-instance.upstash.io"
                      value={upstashUrl}
                      onChange={(e) => setUpstashUrl(e.target.value)}
                      className="pl-9 pr-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="upstash-token" className="text-sm font-medium">
                    Upstash Redis REST Token
                  </Label>
                  <div className="relative">
                    <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="upstash-token"
                      type={showKeys ? 'text' : 'password'}
                      placeholder="Enter your Upstash REST token"
                      value={upstashToken}
                      onChange={(e) => setUpstashToken(e.target.value)}
                      className="pl-9 pr-10"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Default credentials are pre-filled. Token bucket rate limit: 1,000 req/min per IP.</span>
                </div>
              </div>
            )}

            {/* LLM Model Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                AI Classification Model
              </Label>
              <Select value={llmModel} onValueChange={(val) => setLlmModel(val as 'openrouter' | 'nvidia')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select AI model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nvidia">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">GPT-OSS 120B (Nvidia NIM)</span>
                      <span className="text-xs text-muted-foreground">OpenAI GPT-OSS via Nvidia — high quality</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="openrouter">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">MiniMax M2.5 (OpenRouter)</span>
                      <span className="text-xs text-muted-foreground">Free tier via OpenRouter</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* OpenRouter API Key — only shown when openrouter is selected */}
            {llmModel === 'openrouter' && (
              <div className="space-y-2">
                <Label htmlFor="openrouter-key" className="text-sm font-medium">
                  OpenRouter API Key (MiniMax Classification)
                </Label>
                <div className="relative">
                  <Brain className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="openrouter-key"
                    type={showKeys ? 'text' : 'password'}
                    placeholder="Enter your OpenRouter API key for GLM classification"
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    className="pl-9 pr-10"
                  />
                </div>
              </div>
            )}

            {/* Nvidia API Key & Model — only shown when nvidia is selected */}
            {llmModel === 'nvidia' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="nvidia-key" className="text-sm font-medium">
                    Nvidia NIM API Key <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Brain className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="nvidia-key"
                      type={showKeys ? 'text' : 'password'}
                      placeholder="Enter your Nvidia NIM API key"
                      value={nvidiaApiKey}
                      onChange={(e) => setNvidiaApiKey(e.target.value)}
                      className="pl-9 pr-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nvidia-model" className="text-sm font-medium">
                    Nvidia Model Name
                  </Label>
                  <div className="relative">
                    <Brain className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="nvidia-model"
                      type="text"
                      placeholder="openai/gpt-oss-120b"
                      value={nvidiaModel}
                      onChange={(e) => setNvidiaModel(e.target.value)}
                      className="pl-9 pr-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your free key from build.nvidia.com — supports openai/gpt-oss-120b and more
                  </p>
                </div>
              </>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowKeys(!showKeys)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showKeys ? 'Hide keys' : 'Show keys'}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={handleSaveKeys}
                  className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 px-3 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Save Keys
                </button>
                {saveToast && (
                  <span className="absolute right-0 -top-8 text-xs bg-emerald-600 text-white px-2 py-1 rounded shadow-md whitespace-nowrap animate-in fade-in slide-in-from-bottom-1">
                    Keys saved!
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Batch CSV Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Table2 className="w-4 h-4 text-blue-600" />
              Batch CSV Upload
            </CardTitle>
            <CardDescription>
              Upload a CSV file of email addresses. Each email will be processed through the extraction pipeline and results saved to Supabase.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleBatchUpload}
                className="hidden"
                id="csv-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={batchUploading || batchProcessing}
                variant="outline"
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 hover:border-blue-300 min-w-[160px]"
              >
                {batchUploading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Choose CSV File</>
                )}
              </Button>
              <Button
                onClick={downloadTemplate}
                variant="outline"
                className="bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200 hover:border-gray-300"
              >
                <Download className="w-4 h-4 mr-2" /> Download Template
              </Button>
              <p className="text-xs text-muted-foreground">
                CSV with one email per column/row. Max 5MB. Headers are auto-detected.
              </p>
            </div>

            {batchError && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="text-sm">{batchError}</AlertDescription>
              </Alert>
            )}

            {/* Batch Progress Bar */}
            {batchStatus && batchStatus.total > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {batchProcessing && !batchPaused ? '⏳ Processing...' : batchPaused ? '⏸ Paused' : '✅ Done'}
                  </span>
                  <span className="text-muted-foreground">
                    {batchStatus.completed}/{batchStatus.total} completed
                    {batchStatus.errors > 0 && <span className="text-red-500 ml-2">({batchStatus.errors} errors)</span>}
                  </span>
                </div>
                <div className="relative h-3 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      batchStatus.errors > batchStatus.total * 0.3
                        ? 'bg-gradient-to-r from-amber-400 to-red-500'
                        : 'bg-gradient-to-r from-blue-400 to-blue-600'
                    }`}
                    style={{ width: `${Math.max(((batchStatus.completed + batchStatus.errors) / batchStatus.total) * 100, 2)}%` }}
                  />
                </div>
                <div className="flex items-center gap-3">
                  {batchProcessing && (
                    <Button
                      onClick={handleBatchPause}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      {batchPaused ? <><Play className="w-3 h-3 mr-1" /> Resume</> : <><Pause className="w-3 h-3 mr-1" /> Pause</>}
                    </Button>
                  )}
                  {(batchProcessing || batchPaused) && (
                    <Button
                      onClick={handleBatchCancel}
                      variant="outline"
                      size="sm"
                      className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <X className="w-3 h-3 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Download Results Section */}
            {batchStatus && batchStatus.completed > 0 && (
              <div className="border border-dashed border-emerald-300 rounded-lg p-4 bg-emerald-50/50 dark:bg-emerald-950/10 space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Download Results</span>
                  <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">
                    {batchStatus.completed} completed
                  </Badge>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="download-limit" className="text-xs text-muted-foreground whitespace-nowrap">
                      No. of records:
                    </Label>
                    <Input
                      id="download-limit"
                      type="number"
                      min="1"
                      max={batchStatus.completed}
                      placeholder={`All (${batchStatus.completed})`}
                      value={downloadLimit}
                      onChange={(e) => setDownloadLimit(e.target.value)}
                      className="w-[120px] h-8 text-xs"
                    />
                  </div>
                  <Button
                    onClick={downloadResults}
                    disabled={downloading}
                    variant="outline"
                    className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 hover:border-emerald-300 text-xs"
                  >
                    {downloading ? (
                      <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Preparing...</>
                    ) : (
                      <><Download className="w-3 h-3 mr-1.5" /> Download CSV</>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Downloads completed records with all columns. Leave empty to download all.
                  </p>
                </div>
              </div>
            )}

            {/* Batch Results Table */}
            {batchStatus && batchStatus.rows.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">#</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Company</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sectors</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Location</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {batchStatus.rows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2">
                            {row.status === 'completed' && (
                              <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3 h-3" /></span>
                            )}
                            {row.status === 'processing' && (
                              <span className="inline-flex items-center gap-1 text-blue-600"><Loader2 className="w-3 h-3 animate-spin" /></span>
                            )}
                            {row.status === 'pending' && (
                              <span className="inline-flex items-center gap-1 text-gray-400"><Database className="w-3 h-3" /></span>
                            )}
                            {row.status === 'error' && (
                              <span className="inline-flex items-center gap-1 text-red-500" title={row.error_message || ''}><AlertCircle className="w-3 h-3" /></span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-700 max-w-[180px] truncate">{row.email}</td>
                          <td className="px-3 py-2 font-medium text-gray-900 max-w-[200px] truncate">
                            {row.confirmed_name || row.company_name || (row.status === 'error' ? row.error_message?.slice(0, 40) : '—')}
                          </td>
                          <td className="px-3 py-2">
                            {row.company_type && row.company_type !== "Can't Say" ? (
                              <Badge className={`text-[10px] px-1.5 py-0 ${getRoleTypeColor(row.company_type)}`}>
                                {row.company_type}
                              </Badge>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2 max-w-[180px]">
                            <div className="flex flex-wrap gap-0.5">
                              {row.real_estate && row.real_estate !== "Can't Say" && (
                                <Badge className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700">{row.real_estate}</Badge>
                              )}
                              {row.infrastructure && row.infrastructure !== "Can't Say" && (
                                <Badge className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700">{row.infrastructure}</Badge>
                              )}
                              {row.industrial && row.industrial !== "Can't Say" && (
                                <Badge className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700">{row.industrial}</Badge>
                              )}
                              {(!row.real_estate || row.real_estate === "Can't Say") && (!row.infrastructure || row.infrastructure === "Can't Say") && (!row.industrial || row.industrial === "Can't Say") && (
                                <span className="text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{row.location || '—'}</td>
                          <td className="px-3 py-2">
                            {row.confidence != null ? (
                              <span className={`font-medium ${row.confidence >= 0.7 ? 'text-emerald-600' : row.confidence >= 0.5 ? 'text-amber-600' : 'text-red-500'}`}>
                                {Math.round((row.confidence || 0) * 100)}%
                              </span>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Input Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-600" />
              Email Extraction
            </CardTitle>
            <CardDescription>
              Enter an email address to extract company information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="e.g. john.doe@acmecorp.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !loading) handleExtract();
                  }}
                  className="pl-9"
                  disabled={loading}
                />
              </div>
              <Button
                onClick={() => handleExtract()}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px] transition-colors"
              >
                {loading ? (
                  <LoadingButton />
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Extract
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading State — detailed progress (self-contained, no parent re-render) */}
        {loading && !error && <LoadingIndicator />}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertTitle className="font-semibold">
              Extraction Error
            </AlertTitle>
            <AlertDescription className="text-sm">
              <p className="font-medium">{error.message}</p>
              {error.source && (
                <p className="text-xs mt-1 opacity-80">
                  Source: {error.source}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Results Section */}
        {result && (
          <Card className="border-emerald-200 dark:border-emerald-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  Company Profile
                </CardTitle>
                <div className="flex items-center gap-2">
                  {result.cached && (
                    <Badge variant="outline" className="text-xs gap-1 border-emerald-300 text-emerald-700">
                      <Database className="w-3 h-3" />
                      Cached
                    </Badge>
                  )}
                  {result.partial && (
                    <Badge variant="outline" className="text-xs gap-1 border-amber-300 text-amber-700">
                      <Layers className="w-3 h-3" />
                      Partial
                    </Badge>
                  )}
                  {!result.partial && (
                    <Badge variant="outline" className="text-xs gap-1 border-emerald-300 text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" />
                      Complete
                    </Badge>
                  )}
                </div>
              </div>
              <CardDescription>
                Extracted company information from the provided email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Company Name */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="w-4 h-4" />
                  <span>Company Name</span>
                  {result.company.confirmedName && result.company.confirmedName !== result.company.name && (
                    <Badge variant="outline" className="text-xs gap-1 border-blue-300 text-blue-700">
                      <CheckCircle2 className="w-3 h-3" />
                      AI Confirmed
                    </Badge>
                  )}
                </div>
                <p className="text-xl font-bold text-gray-900 pl-6">
                  {result.company.confirmedName || result.company.name}
                </p>
                {/* Show original Serper name if different from confirmed name */}
                {result.company.confirmedName && result.company.confirmedName !== result.company.name && (
                  <p className="text-xs text-muted-foreground pl-6">
                    Original: {result.company.name}
                  </p>
                )}
              </div>

              {/* Domain Info */}
              {(result.discoveredDomain || result.domain) && (
                <div className={`border-l-4 p-3 rounded-r-lg ${result.discoveredDomain ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/20' : 'border-gray-200 bg-gray-50 dark:bg-gray-900/20'}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className={`w-4 h-4 ${result.discoveredDomain ? 'text-blue-600' : 'text-gray-500'}`} />
                    <span className={`font-medium ${result.discoveredDomain ? 'text-blue-800 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                      {result.discoveredDomain ? 'Domain Discovered' : 'Website Domain'}
                    </span>
                  </div>
                  {result.discoveredDomain && (
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 ml-6">
                      The email domain didn't match. Serper identified the actual company website as:
                    </p>
                  )}
                  <p className={`text-sm font-mono font-semibold mt-1 ml-6 ${result.discoveredDomain ? 'text-blue-800 dark:text-blue-200' : 'text-gray-800 dark:text-gray-200'}`}>
                    {result.discoveredDomain || result.domain}
                  </p>
                </div>
              )}

              {/* Location & Contact */}
              {(result.location || result.contactEmail || result.contactPhone) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {result.location && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 text-blue-500" />
                        <span>Office Location</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 pl-6">
                        {result.location}
                      </p>
                    </div>
                  )}
                  {result.contactEmail && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4 text-emerald-500" />
                        <span>Contact Email</span>
                      </div>
                      <a href={`mailto:${result.contactEmail}`} className="text-sm font-medium text-emerald-600 hover:text-emerald-700 pl-6 block truncate">
                        {result.contactEmail}
                      </a>
                    </div>
                  )}
                  {result.contactPhone && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4 text-purple-500" />
                        <span>Contact Phone</span>
                      </div>
                      <a href={`tel:${result.contactPhone}`} className="text-sm font-medium text-purple-600 hover:text-purple-700 pl-6 block">
                        {result.contactPhone}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Company Type */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Shield className="w-4 h-4" />
                  <span>Company Type</span>
                </div>
                <div className="pl-6">
                  <Badge className={`text-sm px-3 py-1 ${getRoleTypeColor(result.company.companyType)}`}>
                    {result.company.companyType}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.company.companyType === 'Developer' && 'Develops or builds real estate/infrastructure projects'}
                    {result.company.companyType === 'Contractor' && 'Executes construction work on behalf of others'}
                    {result.company.companyType === 'Consultant' && 'Engineering/design consulting or advisory services'}
                    {result.company.companyType === "Can't Say" && 'Not classified as a construction/civil engineering company'}
                  </p>
                </div>
              </div>

              {/* Sector Classification — 3 columns */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Layers className="w-4 h-4" />
                  <span>Sector Classification</span>
                </div>
                <div className="pl-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Real Estate</p>
                    <div className="flex flex-wrap">{renderSectorBadges(result.company.realEstate)}</div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Infrastructure</p>
                    <div className="flex flex-wrap">{renderSectorBadges(result.company.infrastructure)}</div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Industrial</p>
                    <div className="flex flex-wrap">{renderSectorBadges(result.company.industrial)}</div>
                  </div>
                </div>
              </div>

              {/* Confidence Score */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pl-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="w-4 h-4" />
                    <span>Confidence Score</span>
                  </div>
                  <span className={`text-2xl font-bold ${getConfidenceColor(result.confidence)}`}>
                    {Math.round(result.confidence * 100)}%
                  </span>
                </div>
                <div className="pl-6">
                  <div className="relative h-3 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        result.confidence >= 0.8
                          ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                          : result.confidence >= 0.6
                          ? 'bg-gradient-to-r from-amber-400 to-amber-600'
                          : 'bg-gradient-to-r from-red-400 to-red-600'
                      }`}
                      style={{ width: `${Math.max(result.confidence * 100, 2)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">
                      {getConfidenceLabel(result.confidence)} confidence
                    </span>
                    <span className={`text-xs font-medium ${getConfidenceColor(result.confidence)}`}>
                      {getConfidenceLabel(result.confidence)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Company Summary */}
              {result.description && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>Company Summary</span>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 pl-6 border-l-2 border-emerald-200 py-1 whitespace-pre-line">
                    {result.description}
                  </p>
                </div>
              )}

              {/* Pipeline Info — shows which services were actually used */}
              {result.pipelineInfo && !result.cached && (
                <div className="border-l-4 border-gray-300 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-r-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="w-4 h-4 text-gray-600" />
                    <span className="font-medium text-gray-700 dark:text-gray-300">Pipeline Details</span>
                    <span className="text-xs text-muted-foreground ml-auto">{result.pipelineInfo.pipelineMs}ms</span>
                  </div>
                  <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      {result.pipelineInfo.usedGLM ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      <span className={result.pipelineInfo.usedGLM ? 'text-emerald-700' : 'text-amber-700'}>
                        Classification: {result.pipelineInfo.classificationSource}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {result.pipelineInfo.scrapedBytes > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      <span className={result.pipelineInfo.scrapedBytes > 0 ? 'text-emerald-700' : 'text-amber-700'}>
                        Scraped: {result.pipelineInfo.scrapedBytes > 0 ? `${result.pipelineInfo.scrapedBytes} chars from ${result.pipelineInfo.scrapingDomain}` : 'No website content'}
                      </span>
                    </div>
                  </div>
                  {!result.pipelineInfo.usedGLM && (
                    <p className="text-xs text-amber-600 mt-1.5 ml-6">
                      ⚠️ GLM classification was not used. Ensure your OpenRouter API key is set.
                    </p>
                  )}
                </div>
              )}

              {/* Status Info + Cache Diagnostic + Re-run Section */}
              <div className="border-t pt-4 mt-4 space-y-3">
                {result.cached && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
                    <Database className="w-3.5 h-3.5" />
                    <span>This result was retrieved from cache.</span>
                  </div>
                )}
                {!result.cached && result.company && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Fresh result — cached for next time.</span>
                  </div>
                )}

                {/* Cache Diagnostic — always shown for debugging */}
                {result.cacheDiagnostic && (
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-2.5 text-xs font-mono space-y-1">
                    <div className="text-muted-foreground font-sans font-medium mb-1">Cache Diagnostic</div>
                    <div className="flex justify-between">
                      <span>Convex:</span>
                      <span className={result.cacheDiagnostic.convexStatus === 'hit' ? 'text-emerald-600' : result.cacheDiagnostic.convexStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'}>
                        {result.cacheDiagnostic.convexStatus} ({result.cacheDiagnostic.convexMs}ms)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>SQLite:</span>
                      <span className={result.cacheDiagnostic.sqliteStatus === 'hit' ? 'text-emerald-600' : result.cacheDiagnostic.sqliteStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'}>
                        {result.cacheDiagnostic.sqliteStatus} ({result.cacheDiagnostic.sqliteMs}ms)
                      </span>
                    </div>
                    {result.cacheDiagnostic.sqliteDetail && (
                      <div className="text-amber-600">{result.cacheDiagnostic.sqliteDetail}</div>
                    )}
                  </div>
                )}

                {result.partial && (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>
                      This is a partial result. Some data sources were unavailable —
                      providing best-effort classification.
                    </span>
                  </div>
                )}

                {/* Force Refresh — only visible when result exists */}
                <div className="border-l-4 border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 p-3 rounded-r-lg space-y-2">
                  <button
                    type="button"
                    onClick={() => handleForceRefresh(email)}
                    disabled={loading}
                    className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-400 hover:text-orange-800 transition-colors w-full text-left disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>Not satisfied with this result? Force re-extract &amp; update cache</span>
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Bypasses cache, re-scrapes from scratch, and overwrites the stored result.
                  </p>
                </div>

                {/* Build version indicator */}
                {result.buildTime && (
                  <div className="text-[10px] text-gray-400 font-mono pt-2 border-t mt-2">
                    Build: {result.buildTime}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* How It Works Section */}
        <Card className="bg-gradient-to-br from-emerald-50/50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="w-4 h-4 text-emerald-600" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <p>
                  <strong className="text-foreground">Domain Extraction</strong> — The email domain is extracted and normalized (e.g., <code className="text-xs bg-muted px-1 rounded">shahi@gajragrop.com</code> → <code className="text-xs bg-muted px-1 rounded">gajragrop.com</code>).
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <p>
                  <strong className="text-foreground">Smart Search</strong> — Serper runs 3 parallel queries: broad search, site-restricted search, and an about/services query. Knowledge Graph data is extracted if available.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <p>
                  <strong className="text-foreground">Domain Discovery</strong> — Search result URLs are analyzed to find the real company website. Fuzzy matching catches variants like <code className="text-xs bg-muted px-1 rounded">gajragrop</code> → <code className="text-xs bg-muted px-1 rounded">gajragroup</code>.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                  4
                </div>
                <p>
                  <strong className="text-foreground">Website Scraping</strong> — Browserless.io renders the real company website (10s JS render budget). Content is cleaned of navigation, addresses, phone numbers, and other junk.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                  5
                </div>
                <p>
                  <strong className="text-foreground">AI Analysis (GLM-4.5)</strong> — An LLM receives ALL data (search snippets + cleaned website content + navigation menu) and produces accurate sector/type classification and a professional company summary paragraph.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                  6
                </div>
                <p>
                  <strong className="text-foreground">Result</strong> — Company name, sector, type, AI-generated summary, and confidence score are returned. Results are cached for faster future requests.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6 text-center text-xs text-muted-foreground">
        <p>Company Information Extractor — Built with Next.js, Prisma, and AI</p>
      </footer>
    </div>
  );
}
