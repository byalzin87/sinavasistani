import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Folder, Exam, Question, AppView, Option } from './types';
import { fileToBase64, fileToText, getMimeType } from './services/fileUtils';
import { parseExamFile } from './services/geminiService';
import { extractTextFromPdf } from './services/pdfParser';
import { parseTextExamLocally } from './services/localExamParser';
import { 
  initSupabase, 
  cloudLogin, 
  cloudRegister, 
  cloudLogout, 
  saveUserData, 
  loadUserData, 
  SupabaseConfig, 
  isSupabaseInitialized, 
  getDefaultConfig,
  isValidSupabaseConfig,
  normalizeSupabaseUrl,
  resetSupabase,
  getSupabase
} from './services/supabase';
import LoadingScreen from './components/LoadingScreen';
import { 
  ArrowLeft, Folder as FolderIcon, Plus, FileText, Trash2, RotateCcw, 
  CheckCircle, Upload, XCircle, Edit2, Save, X, AlertTriangle, Moon, 
  Sun, LogOut, User, Lock, Key, Eye, EyeOff, UserPlus, LogIn, 
  AlertCircle, FileWarning, PlusCircle, MinusCircle, Check,
  Cloud, CloudOff, RefreshCw, BarChart2, PieChart, Activity, TrendingUp,
  Settings, Database, Wifi, WifiOff, ExternalLink, Terminal, ShieldAlert,
  Sliders, HelpCircle, PenTool, Copy, Info
} from 'lucide-react';

// --- Helper Functions for Persistence ---

const normalizeUsername = (username: string) => username.trim().toLocaleLowerCase('tr-TR');
const getStorageKey = (username: string) => `sinav_asistani_data_${normalizeUsername(username)}`;
const getUiKey = (username: string) => `sinav_asistani_ui_${normalizeUsername(username)}`;
const getSettingsKey = (username: string) => `sinav_asistani_settings_${normalizeUsername(username)}`;

const USER_REGISTRY_KEY = 'sinav_asistani_users_registry';
const SUPABASE_CONFIG_KEY = 'sinav_asistani_supabase_config';

// --- Types for Upload Handling ---
interface UploadResult {
  fileName: string;
  status: 'success' | 'error';
  message?: string;
  isMissingApiKey?: boolean;
}

// --- Components defined within App to share state logic easily ---

// 0. Server Configuration Modal
interface ServerConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: SupabaseConfig) => void;
    initialConfig: SupabaseConfig;
}

const ServerConfigModal: React.FC<ServerConfigModalProps> = ({ isOpen, onClose, onSave, initialConfig }) => {
    const [config, setConfig] = useState<SupabaseConfig>(initialConfig);
    const [step, setStep] = useState(1);
    const [validationError, setValidationError] = useState('');

    useEffect(() => { 
        setConfig(initialConfig);
        setValidationError('');
    }, [initialConfig, isOpen]);

    if (!isOpen) return null;

    const handleChange = (key: keyof SupabaseConfig, value: string) => {
        setValidationError('');
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        const trimmedUrl = config.url.trim();
        const trimmedKey = config.anonKey.trim();

        if (!trimmedUrl && !trimmedKey) {
            onSave({ url: '', anonKey: '' });
            return;
        }

        const normalizedConfig = {
            url: normalizeSupabaseUrl(trimmedUrl),
            anonKey: trimmedKey
        };

        if (!isValidSupabaseConfig(normalizedConfig)) {
            setValidationError('Geçersiz Supabase bilgileri. Lütfen geçerli bir Proje URL (örn: https://xyz.supabase.co) ve Anon Key giriniz.');
            setStep(2);
            return;
        }

        setValidationError('');
        onSave(normalizedConfig);
    };

    const handleClearConfig = () => {
        setConfig({ url: '', anonKey: '' });
        setValidationError('');
        onSave({ url: '', anonKey: '' });
    };

    const sqlCode = `
create table profiles (
  id uuid references auth.users not null primary key,
  content jsonb,
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Public profiles" on profiles for all using ( auth.uid() = id );
`.trim();

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full animate-in fade-in zoom-in duration-200 border-t-4 border-green-500 transition-colors flex flex-col max-h-[85dvh]">
                
                {/* Header - Fixed */}
                <div className="p-6 pb-2 flex-shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full text-green-600 dark:text-green-400">
                            <Database className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">Bulut Veritabanı</h3>
                    </div>
                </div>

                {/* Body - Scrollable */}
                <div className="flex-1 overflow-y-auto px-6 py-2">
                    <div className="mb-6 flex items-center justify-between bg-gray-100 dark:bg-gray-700 rounded-lg p-1 sticky top-0 z-10">
                        <button onClick={() => setStep(1)} className={`flex-1 py-2 text-sm font-medium rounded-md transition ${step === 1 ? 'bg-white dark:bg-gray-600 shadow text-green-600 dark:text-green-400' : 'text-gray-500'}`}>1. Kurulum Rehberi</button>
                        <button onClick={() => setStep(2)} className={`flex-1 py-2 text-sm font-medium rounded-md transition ${step === 2 ? 'bg-white dark:bg-gray-600 shadow text-green-600 dark:text-green-400' : 'text-gray-500'}`}>2. Bağlantı Bilgileri</button>
                    </div>

                    {validationError && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{validationError}</span>
                        </div>
                    )}

                    {step === 1 && (
                        <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300 pb-2">
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl">
                                <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2"><ExternalLink className="w-4 h-4"/> Başlamadan Önce</h4>
                                <p>Verilerinizi tüm cihazlarda eşitlemek için ücretsiz bir <strong>Supabase</strong> hesabı açmalısınız. <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline font-bold">Supabase.com</a> adresine gidip "New Project" oluşturun.</p>
                            </div>

                            <div className="space-y-4">
                                <h4 className="font-bold text-gray-900 dark:text-white border-b pb-1 dark:border-gray-700">Yapmanız Gereken 2 Ayar:</h4>
                                
                                <div>
                                    <span className="font-bold text-gray-800 dark:text-gray-200 block mb-1">1. Tabloyu Oluşturun</span>
                                    <p className="mb-2 text-xs">Supabase panelinde sol menüden <strong>SQL Editor</strong>'e gidin, "New Query" diyerek şu kodu yapıştırıp <strong>Run</strong> butonuna basın:</p>
                                    <div className="bg-gray-900 text-gray-100 p-3 rounded-lg font-mono text-xs overflow-x-auto relative group">
                                        <pre>{sqlCode}</pre>
                                        <button onClick={() => navigator.clipboard.writeText(sqlCode)} className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">Kopyala</button>
                                    </div>
                                </div>

                                <div>
                                    <span className="font-bold text-gray-800 dark:text-gray-200 block mb-1">2. Email Onayını Kapatın</span>
                                    <p className="text-xs">
                                        Sol menüden <strong>Authentication</strong> &rarr; <strong>Providers</strong> &rarr; <strong>Email</strong> kısmına gidin.
                                        <br/>
                                        <span className="text-red-500 font-bold">Confirm email</span> seçeneğini kapatıp (Disable) kaydedin. 
                                        <span className="text-xs text-gray-500 italic ml-1">(Böylece kayıt olur olmaz giriş yapabilirsiniz)</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4 pb-2">
                             <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-100 dark:border-yellow-800 text-sm">
                                <p className="text-yellow-800 dark:text-yellow-200 flex items-start gap-2">
                                    <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    Supabase panelinde <strong>Project Settings &rarr; API</strong> kısmındaki bilgileri buraya giriniz.
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Project URL</label>
                                <input 
                                    type="text" 
                                    value={config.url} 
                                    onChange={(e) => handleChange('url', e.target.value)}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-3 text-sm bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none font-mono"
                                    placeholder="https://xyz.supabase.co"
                                />
                            </div>
                             <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Anon / Public Key</label>
                                <input 
                                    type="text" 
                                    value={config.anonKey} 
                                    onChange={(e) => handleChange('anonKey', e.target.value)}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-3 text-sm bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none font-mono"
                                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer - Fixed */}
                <div className="p-6 pt-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0 flex flex-wrap gap-3 bg-white dark:bg-gray-800 rounded-b-2xl">
                    <button onClick={handleSave} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-green-500/20">
                        <Save className="w-4 h-4" /> Kaydet ve Bağlan
                    </button>
                    {(config.url || config.anonKey) && (
                        <button onClick={handleClearConfig} className="bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 font-medium py-3 px-3 rounded-xl transition text-xs">
                            Bağlantıyı Sıfırla (Yerel Mod)
                        </button>
                    )}
                    <button onClick={onClose} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold py-3 px-4 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                        İptal
                    </button>
                </div>
            </div>
        </div>
    );
};

// 1. Login & Register Screen Component
interface LoginScreenProps {
  onLogin: (username: string, isCloud: boolean) => void;
  onOpenServerSettings: () => void;
  isCloudConfigured: boolean;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onOpenServerSettings, isCloudConfigured }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isCloudMode, setIsCloudMode] = useState(isCloudConfigured);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
      // Default to cloud if configured, else local
      setIsCloudMode(isCloudConfigured);
  }, [isCloudConfigured]);

  // Clear errors when switching modes
  useEffect(() => {
    setError('');
    setSuggestions([]);
    setPassword('');
  }, [isRegistering]);

  const generateSuggestions = (baseName: string, registry: any) => {
    const list: string[] = [];
    const now = new Date();
    const seeds = [
      `${baseName}${now.getFullYear()}`,
      `${baseName}_${Math.floor(Math.random() * 100)}`,
      `${baseName}123`,
      `${baseName}.${now.getDate()}`,
      `By${baseName}`
    ];
    seeds.forEach(seed => {
      const key = normalizeUsername(seed);
      if (!registry[key]) list.push(seed);
    });
    return list.slice(0, 3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuggestions([]);
    setLoading(true);

    const trimmedUser = username.trim();
    const userKey = normalizeUsername(trimmedUser);

    if (!trimmedUser || trimmedUser.length < 3) {
      setError('Kullanıcı adı en az 3 karakter olmalıdır.');
      setLoading(false);
      return;
    }
    if (!password || password.length < 4) {
      setError('Şifre en az 4 karakter olmalıdır.');
      setLoading(false);
      return;
    }

    try {
        if (isCloudMode && isCloudConfigured) {
            // CLOUD LOGIN
            if (!isSupabaseInitialized()) {
                setError("Bulut servisi başlatılamadı. Lütfen sunucu ayarlarını kontrol edin veya Yerel Giriş modunu kullanın.");
                setLoading(false);
                return;
            }
            if (isRegistering) {
                await cloudRegister(trimmedUser, password);
                await cloudLogin(trimmedUser, password); // Auto login
            } else {
                await cloudLogin(trimmedUser, password);
            }
            onLogin(trimmedUser, true);
        } else {
            // LOCAL LOGIN
            const registryRaw = localStorage.getItem(USER_REGISTRY_KEY);
            const registry = registryRaw ? JSON.parse(registryRaw) : {};

            if (isRegistering) {
                if (registry[userKey]) {
                    setError('Bu kullanıcı adı yerel hafızada dolu.');
                    setSuggestions(generateSuggestions(trimmedUser, registry));
                    setLoading(false);
                    return;
                }
                registry[userKey] = { password: password, createdAt: new Date().toISOString() };
                localStorage.setItem(USER_REGISTRY_KEY, JSON.stringify(registry));
                onLogin(trimmedUser, false);
            } else {
                const userRecord = registry[userKey];
                if (!userRecord) {
                    setError('Yerel kullanıcı bulunamadı.');
                    setLoading(false);
                    return;
                }
                if (userRecord.password !== password) {
                    setError('Hatalı şifre.');
                    setLoading(false);
                    return;
                }
                onLogin(trimmedUser, false);
            }
        }
    } catch (err: any) {
        console.error(err);
        let msg = err.message || "Bir hata oluştu.";

        // Smart hint for local users trying to login to cloud
        if (isCloudMode && (msg.includes("Kullanıcı adı veya şifre hatalı") || msg.includes("Giriş hatası"))) {
            const registryRaw = localStorage.getItem(USER_REGISTRY_KEY);
            const registry = registryRaw ? JSON.parse(registryRaw) : {};
            const userKey = normalizeUsername(username);
            if (registry[userKey]) {
                msg += " (Not: Bu kullanıcı adı YEREL hafızada kayıtlı. 'Yerel Giriş' moduna geçmeyi deneyin.)";
            }
        }

        setError(msg);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4 transition-colors duration-200 overflow-y-auto">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700 relative my-auto">
        <button 
            onClick={onOpenServerSettings}
            className={`absolute top-4 right-4 p-2 rounded-lg transition-colors ${isCloudConfigured ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
            title="Sunucu Ayarları"
        >
            <Settings className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white font-bold text-3xl shadow-lg shadow-blue-500/30 mx-auto mb-4">
            A
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sınav Asistanı</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${isCloudMode ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                {isCloudMode ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {isCloudMode ? "Bulut Modu (Senkronize)" : "Yerel Mod (Cihaz İçi)"}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isCloudConfigured && (
              <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-100 dark:border-orange-900/30 text-xs text-orange-800 dark:text-orange-200 flex gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p>Cihazlar arası senkronizasyon için sağ üstteki ayarlar butonundan <strong>Supabase</strong> bağlantısını kurun.</p>
              </div>
          )}

          {isCloudConfigured && (
             <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 p-1 rounded-lg">
                <button type="button" onClick={() => setIsCloudMode(false)} className={`flex-1 text-xs font-medium py-1.5 rounded-md transition ${!isCloudMode ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>Yerel Giriş</button>
                <button type="button" onClick={() => setIsCloudMode(true)} className={`flex-1 text-xs font-medium py-1.5 rounded-md transition ${isCloudMode ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>Bulut Giriş</button>
             </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Kullanıcı Adı
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                  setSuggestions([]);
                }}
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="Kullanıcı adı"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Şifre
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                className="block w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </p>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="animate-in slide-in-from-top-2 duration-300">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Şunu deneyebilirsiniz:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => { setUsername(sug); setSuggestions([]); setError(''); }}
                    className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition border border-blue-200 dark:border-blue-800"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all transform active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : isRegistering ? (
                <span className="flex items-center gap-2"><UserPlus className="w-5 h-5"/> Kayıt Ol {isCloudMode && "(Bulut)"}</span>
            ) : (
                <span className="flex items-center gap-2"><LogIn className="w-5 h-5"/> Giriş Yap {isCloudMode && "(Bulut)"}</span>
            )}
          </button>
        </form>
        
        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            {isRegistering 
              ? "Zaten bir hesabınız var mı? Giriş Yapın" 
              : "Hesabınız yok mu? Hemen Kayıt Olun"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ... (Kept existing UploadReportModal)
interface UploadReportModalProps {
  results: UploadResult[];
  isOpen: boolean;
  onClose: () => void;
  onCreateManually: (fileName: string) => void;
}
const SAMPLE_EXAM_TXT = `1. Türkiye'nin başkenti neresidir?
A) İstanbul
B) Ankara
C) İzmir
D) Bursa
Cevap: B

2. Aşağıdakilerden hangisi bir asal sayıdır?
A) 4
B) 6
C) 7
D) 9
Cevap: C

Cevap Anahtarı:
1-B, 2-C`;

const UploadReportModal: React.FC<UploadReportModalProps> = ({ results, isOpen, onClose, onCreateManually }) => {
  const [activeTab, setActiveTab] = useState<'results' | 'guide' | 'template'>('results');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;
  const hasErrors = results.some(r => r.status === 'error');
  const hasMissingApiKey = results.some(
    r => r.isMissingApiKey || (r.message && (r.message.includes('GEMINI_API_KEY') || r.message.includes('ortam değişkeni')))
  );

  const handleCopyTemplate = () => {
    navigator.clipboard.writeText(SAMPLE_EXAM_TXT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-xl w-full animate-in fade-in zoom-in duration-200 border-t-4 border-blue-500 transition-colors flex flex-col max-h-[90dvh]">
        
        {/* Header */}
        <div className="p-6 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${hasErrors ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                {hasErrors ? <AlertCircle className="w-6 h-6 text-orange-600 dark:text-orange-400" /> : <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />}
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">İşlem Raporu</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Yüklenen dosyaların durumu ve çözüm önerileri</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Selector if API key issue or error exists */}
          {hasMissingApiKey && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setActiveTab('results')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${activeTab === 'results' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              >
                Sonuçlar ({results.length})
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition ${activeTab === 'guide' ? 'bg-amber-600 text-white shadow' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'}`}
              >
                <Key className="w-3.5 h-3.5" />
                Ücretsiz Key Kurulumu (Vercel)
              </button>
              <button
                onClick={() => setActiveTab('template')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition ${activeTab === 'template' ? 'bg-emerald-600 text-white shadow' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'}`}
              >
                <FileText className="w-3.5 h-3.5" />
                Ücretsiz Alternatif (.txt)
              </button>
            </div>
          )}
        </div>
        
        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          
          {activeTab === 'results' && (
            <>
              {hasMissingApiKey && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold">
                    <Key className="w-4 h-4 flex-shrink-0" />
                    <span>GEMINI_API_KEY Ortam Değişkeni Eksik</span>
                  </div>
                  <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                    Vercel üzerinde PDF ve resim dosyalarını yapay zekayla okumak için ücretsiz Google Gemini API anahtarı eklenmelidir.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setActiveTab('guide')}
                      className="bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg text-xs font-medium transition"
                    >
                      Kurulum Kılavuzunu Gör
                    </button>
                    <button
                      onClick={() => setActiveTab('template')}
                      className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-amber-100/50 transition"
                    >
                      Anahtarsız Alternatifi İncele
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {results.map((result, idx) => (
                  <div key={idx} className={`p-3.5 rounded-xl border flex flex-col gap-2 ${result.status === 'error' ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30' : 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        {result.status === 'error' ? <FileWarning className="w-5 h-5 text-red-500 flex-shrink-0" /> : <Check className="w-5 h-5 text-green-500 flex-shrink-0" />}
                        <p className="font-semibold text-sm text-gray-800 dark:text-gray-200 truncate" title={result.fileName}>{result.fileName}</p>
                      </div>
                      {result.status === 'error' && (
                        <button onClick={() => onCreateManually(result.fileName)} className="flex-shrink-0 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1.5 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition font-medium">Elle Oluştur</button>
                      )}
                    </div>
                    {result.status === 'error' && (
                      <p className="text-xs text-red-600 dark:text-red-400 pl-7 leading-relaxed">{result.message || 'Okunamadı'}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'guide' && (
            <div className="space-y-4 text-xs text-gray-700 dark:text-gray-300">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3.5 rounded-xl border border-blue-100 dark:border-blue-800 space-y-1">
                <p className="font-bold text-blue-900 dark:text-blue-300">💡 Google Gemini API Tamamen Ücretsizdir!</p>
                <p className="text-blue-800 dark:text-blue-400">
                  Kredi kartı gerekmez. Google AI Studio, dakikada 15 istek ve günlük cömert limitlerle tamamen ücretsiz kullanım imkanı sunar.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl space-y-1.5">
                  <span className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">1</span>
                    Google AI Studio'dan Ücretsiz Key Alın
                  </span>
                  <p className="pl-7 text-gray-600 dark:text-gray-400">
                    Tarayıcınızda <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline font-medium inline-flex items-center gap-1">aistudio.google.com/apikey <ExternalLink className="w-3 h-3" /></a> adresini açın. Google hesabınızla giriş yapıp <strong>"Create API Key"</strong> butonuna basarak anahtarınızı kopyalayın.
                  </p>
                </div>

                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl space-y-1.5">
                  <span className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">2</span>
                    Vercel Dashboard'a Ekleyin
                  </span>
                  <div className="pl-7 space-y-1 text-gray-600 dark:text-gray-400">
                    <p>• <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline inline-flex items-center gap-1">vercel.com/dashboard <ExternalLink className="w-3 h-3" /></a> sayfasında projenizi açın.</p>
                    <p>• <strong>Settings</strong> &gt; <strong>Environment Variables</strong> sekmesine gidin.</p>
                    <p>• Key kısmına: <code className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono font-bold text-blue-600 dark:text-blue-400">GEMINI_API_KEY</code> yazın.</p>
                    <p>• Value kısmına: Kopyaladığınız anahtarı yapıştırıp <strong>Save</strong> butonuna basın.</p>
                  </div>
                </div>

                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl space-y-1.5">
                  <span className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">3</span>
                    Yeniden Dağıtın (Redeploy)
                  </span>
                  <p className="pl-7 text-gray-600 dark:text-gray-400">
                    Vercel'de <strong>Deployments</strong> sekmesine gidin, en üstteki aktif dağıtımın yanındaki <code className="bg-gray-200 dark:bg-gray-800 px-1 py-0.5 rounded">...</code> (üç nokta) menüsünden <strong>Redeploy</strong> seçeneğine tıklayın. 30 saniye içinde tüm PDF ve görselleriniz sorunsuz okunacaktır!
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'template' && (
            <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-800 space-y-1">
                <p className="font-bold text-emerald-900 dark:text-emerald-300">✨ API Anahtarı Olmadan %100 Ücretsiz Kullanım</p>
                <p className="text-emerald-800 dark:text-emerald-400">
                  Uygulamamız metin tabanlı sınavları (.txt, .json, .md) doğrudan tarayıcınızda yerel algoritmayla okur. Hiçbir API anahtarına veya sunucuya ihtiyaç yoktur!
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">Desteklenen Örnek Metin (.txt) Formatı:</span>
                  <button
                    onClick={handleCopyTemplate}
                    className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-2.5 py-1 rounded-lg text-xs font-medium transition"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Kopyalandı!' : 'Şablonu Kopyala'}
                  </button>
                </div>
                <pre className="p-3 bg-gray-900 text-gray-100 rounded-xl font-mono text-[11px] overflow-x-auto leading-relaxed border border-gray-800 select-text">
{SAMPLE_EXAM_TXT}
                </pre>
                <p className="text-gray-500 dark:text-gray-400 text-[11px]">
                  💡 Bu formatta bir metin belgesi (Not Defteri) oluşturup ".txt" olarak kaydedip Dosyalarım &gt; Yükle kısmından yüklerseniz sınavınız anında hazır olacaktır.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0 bg-white dark:bg-gray-800 rounded-b-2xl flex gap-2">
          {activeTab !== 'results' ? (
            <button
              onClick={() => setActiveTab('results')}
              className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold py-2.5 px-4 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm"
            >
              Geri Dön
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold py-2.5 px-4 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm"
            >
              Kapat
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// 1. Reset Confirmation Modal
interface ResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndReset: () => void;
  onJustReset: () => void;
}
const ResetModal: React.FC<ResetModalProps> = ({ isOpen, onClose, onSaveAndReset, onJustReset }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-200 transition-colors flex flex-col max-h-[85dvh]">
        <div className="p-6 pb-2 flex-shrink-0">
             <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Çalışmayı Yenile</h3>
             <p className="text-gray-600 dark:text-gray-300">Sınavı sıfırlamadan önce mevcut sonuçlarınızı ve işaretlemelerinizi bu klasöre kaydetmek ister misiniz?</p>
        </div>
        
        <div className="p-6 pt-4 flex flex-col gap-3 overflow-y-auto">
          <button onClick={onSaveAndReset} className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 flex-shrink-0"><Save className="w-5 h-5" />Sonucu Kaydet ve Sıfırla</button>
          <button onClick={onJustReset} className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition flex-shrink-0">Kaydetmeden Sıfırla</button>
          <button onClick={onClose} className="w-full text-gray-500 dark:text-gray-400 text-sm font-medium py-2 hover:text-gray-700 dark:hover:text-gray-200 transition flex-shrink-0">İptal</button>
        </div>
      </div>
    </div>
  );
};

// 2. Delete Confirmation Modal
interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName: string;
  itemType?: 'exam' | 'folder' | 'question';
}
const DeleteModal: React.FC<DeleteModalProps> = ({ isOpen, onClose, onConfirm, itemName, itemType = 'exam' }) => {
  if (!isOpen) return null;
  const typeText = itemType === 'folder' ? 'klasörü ve içindeki tüm sınavları' : itemType === 'question' ? 'soruyu' : 'sınavı';
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in duration-200 border-t-4 border-red-500 transition-colors flex flex-col max-h-[85dvh]">
        
        <div className="p-6 pb-2 overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
            <div className="bg-red-100 dark:bg-red-900/30 p-2 rounded-full"><AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" /></div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Silme Onayı</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-6"><span className="font-semibold text-gray-800 dark:text-gray-100">"{itemName}"</span> adlı {typeText} silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
        </div>

        <div className="p-6 pt-0 mt-auto flex flex-col gap-3 flex-shrink-0">
          <button onClick={onConfirm} className="w-full bg-red-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-red-700 transition flex items-center justify-center gap-2 shadow-lg shadow-red-500/30"><Trash2 className="w-5 h-5" />Evet, Sil</button>
          <button onClick={onClose} className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition">Vazgeç</button>
        </div>
      </div>
    </div>
  );
};

// NEW: Finish Confirmation Modal
interface FinishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}
const FinishModal: React.FC<FinishModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in duration-200 border-t-4 border-blue-500 transition-colors flex flex-col max-h-[85dvh]">
        <div className="p-6 pb-2">
            <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full"><HelpCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" /></div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Sınavı Bitir</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-6">Sınavı bitirmek istediğinize emin misiniz? Yanıtlarınız kontrol edilecek ve sonuçlar gösterilecek.</p>
        </div>
        <div className="p-6 pt-0 flex flex-col gap-3">
          <button onClick={onConfirm} className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30">Evet, Bitir ve Kontrol Et</button>
          <button onClick={onClose} className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition">Vazgeç</button>
        </div>
      </div>
    </div>
  );
};

// 3. Statistics View
interface StatisticsViewProps {
  folders: Folder[];
  onBack: () => void;
}
const StatisticsView: React.FC<StatisticsViewProps> = ({ folders, onBack }) => {
  // ... Calculation Logic (Same as before)
  const allExams = folders.flatMap(f => f.exams);
  const totalExams = allExams.length;
  let totalQuestions = 0;
  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalIncorrect = 0;
  allExams.forEach(exam => {
    exam.questions.forEach(q => {
      totalQuestions++;
      if (q.userSelection) {
        totalAttempted++;
        if (q.correctAnswerLabel && q.userSelection === q.correctAnswerLabel) {
          totalCorrect++;
        } else if (q.correctAnswerLabel) {
           totalIncorrect++;
        }
      }
    });
  });
  const accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const completion = totalQuestions > 0 ? Math.round((totalAttempted / totalQuestions) * 100) : 0;
  const totalEmpty = totalQuestions - totalAttempted;

  const folderStats = folders.map(f => {
      let fCorrect = 0;
      let fAttempted = 0;
      f.exams.forEach(e => {
          e.questions.forEach(q => {
              if(q.userSelection) {
                  fAttempted++;
                  if(q.correctAnswerLabel && q.userSelection === q.correctAnswerLabel) fCorrect++;
              }
          });
      });
      const fAcc = fAttempted > 0 ? Math.round((fCorrect / fAttempted) * 100) : 0;
      return { id: f.id, name: f.name, accuracy: fAcc, attempted: fAttempted };
  }).filter(f => f.attempted > 0).sort((a,b) => b.accuracy - a.accuracy);

  const weakestExams = allExams.map(e => {
      let eCorrect = 0;
      let eAttempted = 0;
      e.questions.forEach(q => {
          if(q.userSelection) {
              eAttempted++;
              if(q.correctAnswerLabel && q.userSelection === q.correctAnswerLabel) eCorrect++;
          }
      });
      const eAcc = eAttempted > 0 ? Math.round((eCorrect / eAttempted) * 100) : 0;
      return { id: e.id, title: e.title, accuracy: eAcc, attempted: eAttempted };
  }).filter(e => e.attempted >= 5).sort((a,b) => a.accuracy - b.accuracy).slice(0, 5);

  return (
      <div className="p-6 max-w-5xl mx-auto w-full flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <button onClick={onBack} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition flex-shrink-0">
                <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-200" />
            </button>
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <BarChart2 className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                    İstatistikler
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Genel durum ve performans analizi</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between"><div className="flex justify-between items-start mb-2"><p className="text-gray-500 dark:text-gray-400 font-medium">Genel Başarı</p><div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400"><TrendingUp className="w-5 h-5" /></div></div><h3 className="text-3xl font-bold text-gray-900 dark:text-white">%{accuracy}</h3><p className="text-xs text-gray-400 mt-1">Cevaplanan sorular üzerinden</p></div>
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between"><div className="flex justify-between items-start mb-2"><p className="text-gray-500 dark:text-gray-400 font-medium">Tamamlanma</p><div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400"><Activity className="w-5 h-5" /></div></div><h3 className="text-3xl font-bold text-gray-900 dark:text-white">%{completion}</h3><p className="text-xs text-gray-400 mt-1">{totalAttempted} / {totalQuestions} soru çözüldü</p></div>
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between"><div className="flex justify-between items-start mb-2"><p className="text-gray-500 dark:text-gray-400 font-medium">Toplam Soru</p><div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400"><CheckCircle className="w-5 h-5" /></div></div><h3 className="text-3xl font-bold text-gray-900 dark:text-white">{totalQuestions}</h3></div>
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between"><div className="flex justify-between items-start mb-2"><p className="text-gray-500 dark:text-gray-400 font-medium">Sınav Sayısı</p><div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400"><FileText className="w-5 h-5" /></div></div><h3 className="text-3xl font-bold text-gray-900 dark:text-white">{totalExams}</h3></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm"><h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2"><PieChart className="w-5 h-5 text-gray-500" />Soru Dağılımı</h3>{totalQuestions === 0 ? (<div className="text-center py-8 text-gray-400">Veri yok</div>) : (<div className="space-y-6"><div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex"><div style={{ width: `${(totalCorrect/totalQuestions)*100}%` }} className="h-full bg-green-500" /><div style={{ width: `${(totalIncorrect/totalQuestions)*100}%` }} className="h-full bg-red-500" /><div style={{ width: `${(totalEmpty/totalQuestions)*100}%` }} className="h-full bg-gray-300 dark:bg-gray-600" /></div><div className="flex justify-between text-sm"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500" /><span className="text-gray-600 dark:text-gray-300">Doğru: {totalCorrect}</span></div><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500" /><span className="text-gray-600 dark:text-gray-300">Yanlış: {totalIncorrect}</span></div><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600" /><span className="text-gray-600 dark:text-gray-300">Boş: {totalEmpty}</span></div></div></div>)}</div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm"><h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-orange-500" />Geliştirilmesi Gereken Sınavlar</h3><p className="text-xs text-gray-500 dark:text-gray-400 mb-4">En düşük başarı oranına sahip, en az 5 soru çözdüğünüz sınavlar.</p>{weakestExams.length === 0 ? (<div className="text-center py-8 text-gray-400">Yeterli veri yok</div>) : (<div className="space-y-3">{weakestExams.map(ex => (<div key={ex.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"><span className="font-medium text-gray-800 dark:text-gray-200 truncate flex-1 pr-4">{ex.title}</span><div className="flex items-center gap-2"><span className="text-red-500 font-bold">%{ex.accuracy}</span><span className="text-xs text-gray-400">({ex.attempted} soru)</span></div></div>))}</div>)}</div>
          </div>
           <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-8"><h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2"><FolderIcon className="w-5 h-5 text-blue-500" />Klasör Bazlı Performans (Konular)</h3>{folderStats.length === 0 ? (<div className="text-center py-8 text-gray-400">Veri yok</div>) : (<div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">{folderStats.map(f => (<div key={f.id} className="mb-2"><div className="flex justify-between mb-1"><span className="text-sm font-medium text-gray-700 dark:text-gray-300">{f.name}</span><span className="text-sm font-bold text-blue-600 dark:text-blue-400">%{f.accuracy}</span></div><div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${f.accuracy}%` }}></div></div></div>))}</div>)}</div>
      </div>
  );
};

// 4. Settings View
interface SettingsViewProps {
  folders: Folder[];
  defaultFolderId: string | null;
  setDefaultFolderId: (id: string | null) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  onBack: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ folders, defaultFolderId, setDefaultFolderId, darkMode, toggleDarkMode, onBack }) => {
  return (
    <div className="p-6 max-w-2xl mx-auto w-full flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition flex-shrink-0">
              <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-200" />
          </button>
          <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Settings className="w-7 h-7 text-gray-600 dark:text-gray-300" />
                  Ayarlar
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Uygulama tercihlerinizi yapılandırın</p>
          </div>
        </div>

        <div className="space-y-6">
            {/* General Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Sliders className="w-4 h-4" /> Genel Tercihler
                    </h3>
                </div>
                <div className="p-6 space-y-6">
                    {/* Default Folder */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Varsayılan Yükleme Klasörü</label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Ana ekranda "Dosya Yükle" dediğinizde dosyalarınız otomatik olarak bu klasöre eklenecektir.</p>
                        <select 
                            value={defaultFolderId || ""} 
                            onChange={(e) => setDefaultFolderId(e.target.value || null)}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                        >
                            <option value="">Seçiniz (Varsayılan: Yeni 'Genel' Klasör)</option>
                            {folders.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-700 pt-6">
                        <div className="flex items-center justify-between">
                             <div>
                                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">Görünüm Modu</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">Uygulamanın renk temasını değiştirin.</span>
                             </div>
                             <button 
                                onClick={toggleDarkMode}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${darkMode ? 'bg-blue-600' : 'bg-gray-200'}`}
                             >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} />
                             </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Info Section */}
             <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300 flex gap-3">
                 <AlertCircle className="w-5 h-5 flex-shrink-0" />
                 <p>
                     Ayarlarınız bu cihazın hafızasında saklanır. Farklı bir cihazda oturum açtığınızda varsayılan klasör gibi yerel ayarları tekrar yapmanız gerekebilir.
                 </p>
             </div>
        </div>
    </div>
  );
};

// ... ExamTaker ...
interface ExamTakerProps {
  exam: Exam;
  onUpdateExam: (updatedExam: Exam) => void;
  onBack: () => void;
  onResetRequest: () => void;
  onFinishRequest: () => void; // New Prop
  isSaving: boolean;
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  scrollToBottom: () => void; // New Prop
}

const ExamTaker: React.FC<ExamTakerProps> = ({ exam, onUpdateExam, onBack, onResetRequest, onFinishRequest, isSaving, lastSaved, hasUnsavedChanges, scrollToBottom }) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(exam.title);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isKeyCorrectionMode, setIsKeyCorrectionMode] = useState(false);
  const [questionToDeleteId, setQuestionToDeleteId] = useState<number | null>(null);

  useEffect(() => { setTempTitle(exam.title); }, [exam.title]);

  // If exam becomes finished, scroll to bottom
  useEffect(() => {
      if (exam.isFinished) {
          setTimeout(scrollToBottom, 200);
      }
  }, [exam.isFinished, scrollToBottom]);

  const handleOptionSelect = (questionId: number, label: string) => {
    if (isEditMode) return; 
    
    // IF IN KEY CORRECTION MODE: Set the CORRECT ANSWER, not the user selection
    if (isKeyCorrectionMode) {
        const updatedQuestions = exam.questions.map(q => {
            if (q.id === questionId) {
                 return { ...q, correctAnswerLabel: label };
            }
            return q;
        });
        onUpdateExam({ ...exam, questions: updatedQuestions });
        return;
    }

    if (exam.isFinished) return;
    const updatedQuestions = exam.questions.map(q => {
      if (q.id === questionId) { return { ...q, userSelection: q.userSelection === label ? null : label }; }
      return q;
    });
    onUpdateExam({ ...exam, questions: updatedQuestions });
  };

  const saveTitle = () => {
    if (tempTitle.trim()) { onUpdateExam({ ...exam, title: tempTitle }); } else { setTempTitle(exam.title); }
    setIsEditingTitle(false);
  };

  const handleQuestionTextChange = (qId: number, text: string) => { const updated = exam.questions.map(q => q.id === qId ? { ...q, text } : q); onUpdateExam({ ...exam, questions: updated }); };
  const handleOptionTextChange = (qId: number, optLabel: string, text: string) => { const updated = exam.questions.map(q => { if (q.id === qId) { return { ...q, options: q.options.map(o => o.label === optLabel ? { ...o, text } : o) }; } return q; }); onUpdateExam({ ...exam, questions: updated }); };
  const toggleCorrectAnswer = (qId: number, label: string) => { const updated = exam.questions.map(q => { if (q.id === qId) { return { ...q, correctAnswerLabel: q.correctAnswerLabel === label ? null : label }; } return q; }); onUpdateExam({ ...exam, questions: updated }); };
  const addOption = (qId: number) => { const updated = exam.questions.map(q => { if (q.id === qId) { const labels = ["A", "B", "C", "D", "E", "F", "G"]; const nextLabel = labels[q.options.length] || "X"; return { ...q, options: [...q.options, { label: nextLabel, text: "" }] }; } return q; }); onUpdateExam({ ...exam, questions: updated }); };
  const removeOption = (qId: number, label: string) => { const updated = exam.questions.map(q => { if (q.id === qId) { const filtered = q.options.filter(o => o.label !== label); const remapped = filtered.map((o, idx) => { const labels = ["A", "B", "C", "D", "E", "F", "G"]; return { ...o, label: labels[idx] || "?" }; }); return { ...q, options: remapped, correctAnswerLabel: null }; } return q; }); onUpdateExam({ ...exam, questions: updated }); };
  const requestDeleteQuestion = (qId: number) => { setQuestionToDeleteId(qId); };
  const confirmDeleteQuestion = () => { if (questionToDeleteId === null) return; const updated = exam.questions.filter(q => q.id !== questionToDeleteId); onUpdateExam({ ...exam, questions: updated }); setQuestionToDeleteId(null); };
  const addQuestion = () => { const newQ: Question = { id: Math.floor(Math.random() * 100000), text: "", options: [ { label: "A", text: "" }, { label: "B", text: "" }, { label: "C", text: "" }, { label: "D", text: "" }, ], correctAnswerLabel: null, userSelection: null }; onUpdateExam({ ...exam, questions: [...exam.questions, newQ] }); setTimeout(scrollToBottom, 100); };

  // --- Statistics Calculation ---
  const totalQuestions = exam.questions.length;
  const correctCount = exam.questions.filter(q => q.userSelection && q.userSelection === q.correctAnswerLabel).length;
  const wrongCount = exam.questions.filter(q => q.userSelection && q.userSelection !== q.correctAnswerLabel).length;
  const emptyCount = totalQuestions - (correctCount + wrongCount);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 transition-colors">
      <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 flex items-center justify-between gap-4 transition-colors">
        <div className="flex items-center gap-2">
            <button onClick={onBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition flex-shrink-0"><ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-300" /></button>
            <div className="hidden sm:flex flex-col"><div className="flex items-center gap-1.5 text-xs">{isSaving ? (<span className="flex items-center gap-1 text-blue-500 font-medium animate-pulse"><RefreshCw className="w-3 h-3 animate-spin" /> Kaydediliyor...</span>) : hasUnsavedChanges ? (<span className="flex items-center gap-1 text-orange-500 font-medium"><CloudOff className="w-3 h-3" /> Kaydedilmedi</span>) : (<span className="flex items-center gap-1 text-gray-400 dark:text-gray-500"><Cloud className="w-3 h-3" /> {lastSaved ? `Son kayıt: ${lastSaved.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 'Hazır'}</span>)}</div></div>
        </div>
        <div className="flex-1 flex items-center gap-2 overflow-hidden justify-center sm:justify-start">{isEditingTitle ? (<div className="flex items-center gap-2 w-full max-w-md"><input type="text" value={tempTitle} onChange={(e) => setTempTitle(e.target.value)} className="flex-1 border border-blue-300 dark:border-blue-500 rounded px-2 py-1 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveTitle()} /><button onClick={saveTitle} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"><CheckCircle className="w-5 h-5" /></button><button onClick={() => { setIsEditingTitle(false); setTempTitle(exam.title); }} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"><XCircle className="w-5 h-5" /></button></div>) : (<div className="flex items-center gap-2 group cursor-pointer max-w-full" onClick={() => setIsEditingTitle(true)}><h1 className="text-lg font-bold truncate text-gray-800 dark:text-white" title="Başlığı düzenlemek için tıklayın">{exam.title}</h1><Edit2 className="w-4 h-4 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" /></div>)}</div>
        <div className="flex items-center gap-2">
            {exam.isFinished && (
                <button 
                    onClick={() => { setIsKeyCorrectionMode(!isKeyCorrectionMode); setIsEditMode(false); }} 
                    className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${isKeyCorrectionMode ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`} 
                    title="Cevap Anahtarı Düzeltme Modu"
                >
                    <Key className="w-4 h-4" />
                    <span className="hidden sm:inline">{isKeyCorrectionMode ? 'Tamamla' : 'Anahtarı Düzenle'}</span>
                </button>
            )}
            <button onClick={() => { setIsEditMode(!isEditMode); setIsKeyCorrectionMode(false); }} className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${isEditMode ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`} title="Düzenleme Modu">{isEditMode ? <Check className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}<span className="hidden sm:inline">{isEditMode ? 'Tamamla' : 'Düzenle'}</span></button>
            {exam.isFinished && !isEditMode && !isKeyCorrectionMode && (<button onClick={onResetRequest} className="flex-shrink-0 flex items-center gap-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition"><RotateCcw className="w-4 h-4" /><span className="hidden sm:inline">Yeniden Çalış</span></button>)}
        </div>
      </div>
      {isEditMode && (<div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-2 text-xs sm:text-sm text-orange-800 dark:text-orange-200 text-center border-b border-orange-100 dark:border-orange-900/30">Düzenleme Modu: Soruları ve şıkları değiştirebilirsiniz. Doğru cevabı ayarlamak için şık harfine (A, B...) tıklayın.</div>)}
      {isKeyCorrectionMode && (<div className="bg-purple-50 dark:bg-purple-900/20 px-4 py-2 text-xs sm:text-sm text-purple-800 dark:text-purple-200 text-center border-b border-purple-100 dark:border-purple-900/30 flex items-center justify-center gap-2"><PenTool className="w-4 h-4"/> Cevap Anahtarı Düzeltme Modu: Doğru olduğunu bildiğiniz şıkkın üzerine tıklayarak anahtarı güncelleyin.</div>)}
      
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <DeleteModal isOpen={questionToDeleteId !== null} onClose={() => setQuestionToDeleteId(null)} onConfirm={confirmDeleteQuestion} itemName={questionToDeleteId ? `Soru ${exam.questions.findIndex(q => q.id === questionToDeleteId) + 1}` : "Soru"} itemType="question" />
        {exam.questions.length === 0 && (<div className="text-center py-10 opacity-60"><p className="text-xl text-gray-500 dark:text-gray-400">Bu sınavda henüz soru yok.</p>{isEditMode && <p className="text-sm mt-2 text-blue-500">Aşağıdaki butonu kullanarak soru ekleyin.</p>}</div>)}
        {exam.questions.map((q, index) => (
          <div key={q.id} className={`mb-8 border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0 group/question ${isKeyCorrectionMode ? 'ring-2 ring-purple-100 dark:ring-purple-900/20 p-4 rounded-xl' : ''}`}>
            <div className="flex gap-3 mb-4"><span className="font-bold text-gray-900 dark:text-gray-100 text-lg pt-1">{index + 1}.</span><div className="flex-1">{isEditMode ? (<textarea value={q.text} onChange={(e) => handleQuestionTextChange(q.id, e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[80px]" placeholder="Soru metni..." />) : (<p className="text-gray-800 dark:text-gray-200 text-lg leading-relaxed whitespace-pre-wrap">{q.text}</p>)}</div>{isEditMode && (<button onClick={() => requestDeleteQuestion(q.id)} className="self-start p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 className="w-5 h-5" /></button>)}</div>
            <div className="space-y-3 pl-2 sm:pl-8">
              {q.options.map((opt) => {
                const isSelected = q.userSelection === opt.label; const isCorrect = q.correctAnswerLabel === opt.label;
                let containerClass = "w-full text-left p-3 rounded-xl border-2 transition-all duration-200 flex items-start gap-3 group relative ";
                let labelClass = "font-bold min-w-[24px] "; let textClass = "flex-1 ";
                
                if (isKeyCorrectionMode) {
                    // Key correction visual
                    containerClass += isCorrect ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 " : "border-dashed border-gray-300 dark:border-gray-700 hover:border-purple-400 cursor-pointer ";
                    labelClass += isCorrect ? "text-purple-700 dark:text-purple-400 font-bold " : "text-gray-500 dark:text-gray-400 ";
                    textClass += "text-gray-900 dark:text-gray-300";
                } else if (isEditMode) { 
                    containerClass += isCorrect ? "border-green-500 bg-green-50 dark:bg-green-900/10 " : "border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-400 "; labelClass += isCorrect ? "text-green-700 cursor-pointer hover:scale-110 transition-transform " : "text-gray-500 cursor-pointer hover:text-blue-500 "; textClass += "text-gray-900 dark:text-gray-300"; 
                } else if (!exam.isFinished) { 
                    if (isSelected) { containerClass += "border-green-500 bg-green-50 dark:bg-green-900/20 shadow-sm"; labelClass += "text-green-700 dark:text-green-400"; textClass += "text-gray-900 dark:text-gray-100"; } else { containerClass += "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"; labelClass += "text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200"; textClass += "text-gray-900 dark:text-gray-300"; } 
                } else { 
                    // Finished View
                    if (isCorrect) { containerClass += "border-green-500 bg-green-100/40 dark:bg-green-900/40 shadow-sm"; textClass += "text-green-800 dark:text-green-400 font-bold"; labelClass += "text-green-800 dark:text-green-400 font-bold"; } else if (isSelected) { containerClass += "border-red-500 bg-red-50 dark:bg-red-900/20 shadow-sm"; textClass += "text-red-700 dark:text-red-400 font-bold"; labelClass += "text-red-700 dark:text-red-400 font-bold"; } else { containerClass += "border-gray-200 dark:border-gray-700 opacity-60"; textClass += "text-gray-900 dark:text-gray-400"; labelClass += "text-gray-900 dark:text-gray-400 font-medium"; } 
                }

                return (<div key={opt.label} className="relative"><button onClick={() => handleOptionSelect(q.id, opt.label)} disabled={(exam.isFinished && !isKeyCorrectionMode) || isEditMode} className={containerClass}><span className={labelClass} title={isEditMode || isKeyCorrectionMode ? "Doğru cevap olarak işaretle" : ""} onClick={(e) => { if(isEditMode) { e.stopPropagation(); toggleCorrectAnswer(q.id, opt.label); } }}>{opt.label})</span>{isEditMode ? (<input type="text" value={opt.text} onChange={(e) => handleOptionTextChange(q.id, opt.label, e.target.value)} className="flex-1 bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none w-full" placeholder="Şık metni..." onClick={e => e.stopPropagation()} />) : (<span className={textClass}>{opt.text}</span>)}{!isEditMode && !isKeyCorrectionMode && isSelected && !exam.isFinished && (<CheckCircle className="absolute right-3 top-3 w-5 h-5 text-green-500" />)}{!isEditMode && !isKeyCorrectionMode && exam.isFinished && isCorrect && (<CheckCircle className="absolute right-3 top-3 w-5 h-5 text-green-600 dark:text-green-400" />)}{!isEditMode && !isKeyCorrectionMode && exam.isFinished && isSelected && !isCorrect && (<XCircle className="absolute right-3 top-3 w-5 h-5 text-red-500 dark:text-red-400" />)}</button>{isEditMode && (<button onClick={() => removeOption(q.id, opt.label)} className="absolute right-[-30px] top-4 text-red-300 hover:text-red-500"><MinusCircle className="w-5 h-5" /></button>)}</div>);
              })}
              {isEditMode && (<button onClick={() => addOption(q.id)} className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-2"><PlusCircle className="w-4 h-4" /> Şık Ekle</button>)}
            </div>
          </div>
        ))}
        {isEditMode ? (<button onClick={addQuestion} className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-gray-500 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-gray-800 transition flex flex-col items-center justify-center gap-2 mb-12"><PlusCircle className="w-8 h-8" /><span className="font-bold">Yeni Soru Ekle</span></button>) : (!exam.isFinished && exam.questions.length > 0 && (<div className="mt-8 mb-12 flex justify-center"><button onClick={onFinishRequest} className="bg-blue-600 text-white text-lg font-bold py-4 px-12 rounded-full shadow-lg hover:bg-blue-700 hover:shadow-xl transform hover:-translate-y-1 transition-all active:scale-95 dark:shadow-blue-900/50">SINAVI BİTİR</button></div>))}
        
        {exam.isFinished && !isEditMode && !isKeyCorrectionMode && (
        <div className="mt-8 mb-12 p-6 bg-gray-100 dark:bg-gray-800 rounded-xl text-center border border-gray-200 dark:border-gray-700 shadow-sm">
            <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-6">Sınav Sonucu</h3>
            
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="flex flex-col items-center p-3 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-900/30">
                    <span className="text-2xl font-bold text-green-600 dark:text-green-400">{correctCount}</span>
                    <span className="text-xs font-medium text-green-800 dark:text-green-300 mt-1">Doğru</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-900/30">
                    <span className="text-2xl font-bold text-red-600 dark:text-red-400">{wrongCount}</span>
                    <span className="text-xs font-medium text-red-800 dark:text-red-300 mt-1">Yanlış</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-gray-200 dark:bg-gray-700 rounded-xl border border-gray-300 dark:border-gray-600">
                     <span className="text-2xl font-bold text-gray-700 dark:text-gray-300">{emptyCount}</span>
                     <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-1">Boş</span>
                </div>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">
                Toplam <strong>{totalQuestions}</strong> soruda performansınız yukarıdaki gibidir.
            </p>

            <button onClick={onResetRequest} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-2 px-6 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition">Yeniden Çalış</button>
        </div>
        )}
      </div>
    </div>
  );
};

// --- Main App Component ---

const App: React.FC = () => {
  // ... state logic ...
  const [currentUser, setCurrentUser] = useState<string | null>(() => { if (typeof window !== 'undefined') return localStorage.getItem('sinav_asistani_active_user'); return null; });
  const [isCloudSession, setIsCloudSession] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentView, setCurrentView] = useState<AppView>('DASHBOARD');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const foldersRef = useRef<Folder[]>([]); 
  const isDirtyRef = useRef(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseConfig>(() => {
    try {
      const stored = localStorage.getItem(SUPABASE_CONFIG_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isValidSupabaseConfig(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("Stored Supabase config error", e);
    }
    const defaults = getDefaultConfig();
    if (isValidSupabaseConfig(defaults)) return defaults;
    return { url: '', anonKey: '' };
  });
  const [isEditingFolderName, setIsEditingFolderName] = useState(false);
  const [tempFolderName, setTempFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderTempName, setEditFolderTempName] = useState("");
  
  // Modals State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [examToDeleteId, setExamToDeleteId] = useState<string | null>(null);
  const [folderToDeleteId, setFolderToDeleteId] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [isUploadReportOpen, setIsUploadReportOpen] = useState(false);

  // Scroll Ref
  const mainScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isValidSupabaseConfig(supabaseConfig)) {
      try {
        initSupabase(supabaseConfig);
      } catch (e) {
        console.warn("Supabase init failed", e);
      }
    } else {
      resetSupabase();
    }
  }, [supabaseConfig]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('sinav_asistani_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      setIsInitialized(false);
      const load = async () => {
        let loadedFolders: Folder[] = [];
        if (isCloudSession && isValidSupabaseConfig(supabaseConfig)) {
          try {
            const client = getSupabase() || initSupabase(supabaseConfig);
            if (client) {
              const { data } = await client.auth.getSession();
              if (data && data.session?.user) {
                const userData = await loadUserData(data.session.user.id);
                if (userData) loadedFolders = userData;
              }
            }
          } catch(e) {
            console.error("Cloud load error", e);
          }
        }
        
        if (loadedFolders.length === 0) {
          const storageKey = getStorageKey(currentUser);
          const savedData = localStorage.getItem(storageKey);
          if (savedData) {
            try {
              loadedFolders = JSON.parse(savedData);
            } catch (e) {
              console.error("Data load error", e);
            }
          }
        }
        
        setFolders(loadedFolders);
        foldersRef.current = loadedFolders;
        setIsInitialized(true);
        
        const uiKey = getUiKey(currentUser);
        const savedUi = localStorage.getItem(uiKey);
        if (savedUi) {
          try {
            const ui = JSON.parse(savedUi);
            if (ui.currentView) setCurrentView(ui.currentView);
            if (ui.activeFolderId) setActiveFolderId(ui.activeFolderId);
            if (ui.activeExamId) setActiveExamId(ui.activeExamId);
          } catch (e) {
            console.error("UI state load error", e);
          }
        }
        
        const settingsKey = getSettingsKey(currentUser);
        const savedSettings = localStorage.getItem(settingsKey);
        if (savedSettings) {
          try {
            const parsedSettings = JSON.parse(savedSettings);
            if (parsedSettings.defaultFolderId) setDefaultFolderId(parsedSettings.defaultFolderId);
          } catch(e) {
            console.error("Settings load error", e);
          }
        }
      };
      load();
    }
  }, [currentUser, isCloudSession, supabaseConfig]);

  useEffect(() => {
    if (isInitialized) {
      foldersRef.current = folders;
      isDirtyRef.current = true;
    }
  }, [folders, isInitialized]);

  useEffect(() => {
    if (currentUser && isInitialized) {
      const uiKey = getUiKey(currentUser);
      localStorage.setItem(uiKey, JSON.stringify({ currentView, activeFolderId, activeExamId }));
    }
  }, [currentView, activeFolderId, activeExamId, currentUser, isInitialized]);

  useEffect(() => {
    if (currentUser && isInitialized) {
      const settingsKey = getSettingsKey(currentUser);
      localStorage.setItem(settingsKey, JSON.stringify({ defaultFolderId }));
    }
  }, [defaultFolderId, currentUser, isInitialized]);

  const performSave = useCallback(async () => {
    if(!currentUser) return;
    setIsSaving(true);
    try {
      if (isCloudSession && isSupabaseInitialized()) {
        const client = getSupabase();
        if (client) {
          const { data } = await client.auth.getSession();
          if (data && data.session?.user) {
            await saveUserData(data.session.user.id, foldersRef.current);
          }
        }
      }
      const storageKey = getStorageKey(currentUser);
      localStorage.setItem(storageKey, JSON.stringify(foldersRef.current));
      setLastSaved(new Date());
      isDirtyRef.current = false;
    } catch (e) {
      console.error("Save failed", e);
    } finally {
      setTimeout(() => setIsSaving(false), 800);
    }
  }, [currentUser, isCloudSession]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isDirtyRef.current && isInitialized && currentUser) {
        performSave();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [currentUser, isInitialized, performSave]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        if (!isCloudSession && currentUser) {
          const key = getStorageKey(currentUser);
          localStorage.setItem(key, JSON.stringify(foldersRef.current));
        }
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentUser, isCloudSession]);

  const handleInternalNavigation = () => {
    if (isDirtyRef.current) performSave();
  };

  useEffect(() => {
    if (!isInitialized) return;
    if (activeFolderId) {
      const folder = folders.find(f => f.id === activeFolderId);
      if (!folder) {
        setActiveFolderId(null);
        setCurrentView('DASHBOARD');
        return;
      }
      if (activeExamId) {
        const exam = folder.exams.find(e => e.id === activeExamId);
        if (!exam) {
          setActiveExamId(null);
          setCurrentView('FOLDER_DETAIL');
        }
      }
    }
  }, [folders, activeFolderId, activeExamId, isInitialized]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('sinav_asistani_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('sinav_asistani_theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    if (activeFolderId) {
      const folder = folders.find(f => f.id === activeFolderId);
      if (folder) setTempFolderName(folder.name);
    }
  }, [activeFolderId, folders]);

  const handleLogin = (username: string, cloudMode: boolean) => {
    const trimmedUser = username.trim();
    localStorage.setItem('sinav_asistani_active_user', trimmedUser);
    setCurrentUser(trimmedUser);
    setIsCloudSession(cloudMode);
  };

  const handleLogout = async () => {
    if (isDirtyRef.current) await performSave();
    if (isCloudSession) await cloudLogout();
    localStorage.removeItem('sinav_asistani_active_user');
    setCurrentUser(null);
    setFolders([]);
    setActiveFolderId(null);
    setActiveExamId(null);
    setDefaultFolderId(null);
    setCurrentView('DASHBOARD');
    setIsInitialized(false);
    setIsCloudSession(false);
  };

  const handleServerConfigSave = (config: SupabaseConfig) => {
    if (isValidSupabaseConfig(config)) {
      const cleanConfig = {
        url: normalizeSupabaseUrl(config.url),
        anonKey: config.anonKey.trim()
      };
      setSupabaseConfig(cleanConfig);
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cleanConfig));
      initSupabase(cleanConfig);
    } else {
      setSupabaseConfig({ url: '', anonKey: '' });
      localStorage.removeItem(SUPABASE_CONFIG_KEY);
      resetSupabase();
    }
    setIsServerModalOpen(false);
  };
  const toggleDarkMode = () => setDarkMode(!darkMode);
  const createFolder = () => { const newId = crypto.randomUUID(); const defaultName = "Yeni Klasör"; const newFolder: Folder = { id: newId, name: defaultName, exams: [] }; setFolders(prev => [...prev, newFolder]); setEditingFolderId(newId); setEditFolderTempName(defaultName); };
  const requestDeleteFolder = (e: React.MouseEvent, id: string) => { e.stopPropagation(); setFolderToDeleteId(id); };
  const confirmDeleteFolder = () => {
    if (!folderToDeleteId) return;
    setFolders(prev => prev.filter(f => f.id !== folderToDeleteId));
    if (activeFolderId === folderToDeleteId) {
      setActiveFolderId(null);
      setCurrentView('DASHBOARD');
    }
    if (defaultFolderId === folderToDeleteId) setDefaultFolderId(null);
    setFolderToDeleteId(null);
  };
  const startEditingFolder = (e: React.MouseEvent, folder: Folder) => { e.stopPropagation(); setEditingFolderId(folder.id); setEditFolderTempName(folder.name); };
  const saveFolderEdit = (e: React.MouseEvent | React.FormEvent | React.KeyboardEvent) => { e.stopPropagation(); if (editingFolderId && editFolderTempName.trim()) { setFolders(prev => prev.map(f => f.id === editingFolderId ? { ...f, name: editFolderTempName } : f)); setEditingFolderId(null); } else { setEditingFolderId(null); } };
  const cancelFolderEdit = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation(); setEditingFolderId(null); };
  const saveFolderNameDetail = () => { if (activeFolderId && tempFolderName.trim()) { setFolders(prev => prev.map(f => f.id === activeFolderId ? { ...f, name: tempFolderName } : f)); setIsEditingFolderName(false); } else { const folder = folders.find(f => f.id === activeFolderId); if (folder) setTempFolderName(folder.name); setIsEditingFolderName(false); } };
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, targetFolderId?: string) => {
    const inputElement = event.target;
    const files = inputElement.files;
    if (!files || files.length === 0) return;
    
    let folderId = targetFolderId || activeFolderId;
    if (!folderId && defaultFolderId) {
      const exists = folders.find(f => f.id === defaultFolderId);
      if (exists) {
        folderId = defaultFolderId;
      } else {
        setDefaultFolderId(null);
      }
    }
    
    let newFolderId = "";
    if (!folderId) {
      newFolderId = crypto.randomUUID();
      folderId = newFolderId;
      const newFolder: Folder = { id: newFolderId, name: "Genel", exams: [] };
      setFolders(prev => [...prev, newFolder]);
    }
    
    setCurrentView('LOADING');
    setUploadResults([]);
    const results: UploadResult[] = [];
    const processedExams: { folderId: string, exam: Exam }[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setLoadingMessage(`Dosya inceleniyor ve sorular çıkarılıyor (${i + 1}/${files.length}): ${file.name}`);
      try {
        const originalMime = getMimeType(file);
        let mimeType = originalMime;
        let data = '';
        let extractedPdfText = '';

        if (file.name.toLowerCase().endsWith('.pdf') || originalMime === 'application/pdf') {
          setLoadingMessage(`PDF taranıyor ve metinler ayıklanıyor (${i + 1}/${files.length}): ${file.name}`);
          try {
            const pdfResult = await extractTextFromPdf(file);
            if (pdfResult.isClean && pdfResult.text && pdfResult.text.trim().length > 30) {
              extractedPdfText = pdfResult.text;
              data = extractedPdfText;
              mimeType = 'text/plain';
            } else {
              // Text was garbled/shifted beyond repair or empty, fallback to visual PDF
              data = await fileToBase64(file);
              mimeType = 'application/pdf';
            }
          } catch (pdfErr) {
            console.warn('PDF text extraction error:', pdfErr);
            data = await fileToBase64(file);
            mimeType = 'application/pdf';
          }
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          data = await fileToText(file);
        } else {
          data = await fileToBase64(file);
        }
        
        setLoadingMessage(`Sorular ve cevaplar çıkarılıyor (${i + 1}/${files.length}): ${file.name}`);
        const parsedData = await parseExamFile(data, mimeType, file.name, extractedPdfText);
        
        if (parsedData.questions.length === 0) {
          results.push({
            fileName: file.name,
            status: 'error',
            message: parsedData.errorMessage || "Belgeden soru tespit edilemedi veya dosya formatı desteklenmiyor.",
            isMissingApiKey: parsedData.isMissingApiKey || (parsedData.errorMessage ? parsedData.errorMessage.includes('GEMINI_API_KEY') : false)
          });
        } else {
          const newExam: Exam = {
            id: crypto.randomUUID(),
            title: parsedData.title,
            dateCreated: new Date().toISOString(),
            questions: parsedData.questions,
            isFinished: false
          };
          processedExams.push({ folderId: folderId!, exam: newExam });
          results.push({ fileName: file.name, status: 'success' });
        }
      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
        results.push({
          fileName: file.name,
          status: 'error',
          message: error?.message || "İşlem sırasında beklenmeyen bir hata oluştu."
        });
      }
    }
    
    if (processedExams.length > 0) {
      setFolders(prev => prev.map(f => {
        const folderExamsToAdd = processedExams.filter(pe => pe.folderId === f.id).map(pe => pe.exam);
        if (folderExamsToAdd.length > 0) {
          return { ...f, exams: [...f.exams, ...folderExamsToAdd] };
        }
        return f;
      }));
    }
    
    setUploadResults(results);
    setLoadingMessage(null);
    inputElement.value = '';
    
    const hasErrors = results.some(r => r.status === 'error');
    if (hasErrors) {
      if (!activeFolderId && folderId) setActiveFolderId(folderId);
      setCurrentView('FOLDER_DETAIL');
      setIsUploadReportOpen(true);
    } else {
      if (!activeFolderId && folderId) setActiveFolderId(folderId);
      if (files.length === 1 && processedExams.length === 1) {
        setActiveExamId(processedExams[0].exam.id);
        setCurrentView('EXAM_TAKER');
      } else {
        setCurrentView('FOLDER_DETAIL');
      }
    }
  };
  const handleManualCreate = (fileName: string) => { if (!activeFolderId) return; const newExam: Exam = { id: crypto.randomUUID(), title: fileName, dateCreated: new Date().toISOString(), questions: [], isFinished: false }; setFolders(prev => prev.map(f => { if (f.id === activeFolderId) { return { ...f, exams: [...f.exams, newExam] }; } return f; })); setIsUploadReportOpen(false); setActiveExamId(newExam.id); setCurrentView('EXAM_TAKER'); };
  const updateExamInState = (updatedExam: Exam) => { setFolders(prev => prev.map(f => { if (f.id === activeFolderId) { return { ...f, exams: f.exams.map(e => e.id === updatedExam.id ? updatedExam : e) }; } return f; })); };
  
  const handleResetRequest = () => setIsResetModalOpen(true);
  
  const handleFinishRequest = () => setIsFinishModalOpen(true);
  const confirmFinishExam = () => {
      if (!activeFolderId || !activeExamId) return;
      setFolders(prev => prev.map(f => {
          if (f.id === activeFolderId) {
              return { ...f, exams: f.exams.map(e => e.id === activeExamId ? { ...e, isFinished: true } : e) };
          }
          return f;
      }));
      setIsFinishModalOpen(false);
  };

  const handleArchiveAndReset = () => { if (!activeFolderId || !activeExamId) return; setFolders(prev => prev.map(f => { if (f.id === activeFolderId) { const currentExam = f.exams.find(e => e.id === activeExamId); if (!currentExam) return f; const dateStr = new Date().toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' }); const archivedExam: Exam = { ...JSON.parse(JSON.stringify(currentExam)), id: crypto.randomUUID(), title: `${currentExam.title} (Tamamlandı - ${dateStr})`, isFinished: true, }; const resetExam: Exam = { ...currentExam, isFinished: false, questions: currentExam.questions.map(q => ({ ...q, userSelection: null })) }; return { ...f, exams: [...f.exams.filter(e => e.id !== activeExamId), archivedExam, resetExam] }; } return f; })); setIsResetModalOpen(false); };
  const handleJustReset = () => { if (!activeFolderId || !activeExamId) return; setFolders(prev => prev.map(f => { if (f.id === activeFolderId) { return { ...f, exams: f.exams.map(e => e.id === activeExamId ? { ...e, isFinished: false, questions: e.questions.map(q => ({ ...q, userSelection: null })) } : e) }; } return f; })); setIsResetModalOpen(false); };
  const requestDeleteExam = (e: React.MouseEvent, examId: string) => { e.stopPropagation(); setExamToDeleteId(examId); };
  const confirmDeleteExam = () => { if (!examToDeleteId) return; setFolders(prev => prev.map(f => { if (f.id === activeFolderId) { return { ...f, exams: f.exams.filter(ex => ex.id !== examToDeleteId) }; } return f; })); setExamToDeleteId(null); };

  const scrollToBottom = () => {
      if (mainScrollRef.current) {
          mainScrollRef.current.scrollTo({ top: mainScrollRef.current.scrollHeight, behavior: 'smooth' });
      }
  };

  const renderDashboard = () => (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
           <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
             <FolderIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
             Dosyalarım
           </h1>
           <p className="text-gray-500 dark:text-gray-400 mt-1">Sınavlarınızı klasörler altında düzenleyin.</p>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={() => setCurrentView('STATISTICS')} className="p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm flex items-center gap-2 font-medium">
               <BarChart2 className="w-5 h-5 text-blue-500" />
               <span className="hidden sm:inline">İstatistikler</span>
            </button>
             <button onClick={() => setCurrentView('SETTINGS')} className="p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm flex items-center gap-2 font-medium">
               <Settings className="w-5 h-5 text-gray-500" />
               <span className="hidden sm:inline">Ayarlar</span>
            </button>
            <label className="p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm flex items-center gap-2 font-medium cursor-pointer">
               <Upload className="w-5 h-5 text-blue-500" />
               <span className="hidden sm:inline">Sınav Yükle</span>
               <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileUpload} />
            </label>
            <button onClick={createFolder} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl shadow-lg shadow-blue-500/30 flex items-center gap-2 transition transform active:scale-95 font-bold">
              <Plus className="w-5 h-5" />
              Klasör Oluştur
            </button>
        </div>
      </div>

      {folders.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center p-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-full mb-4">
                <Upload className="w-12 h-12 text-blue-500 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Henüz sınav veya klasör yok</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm">PDF, resim veya metin formatındaki sınavlarınızı yükleyerek hemen başlayın.</p>
            <div className="flex flex-col sm:flex-row gap-3 items-center">
              <label className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" /> PDF / Sınav Dosyası Yükle
                <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileUpload} />
              </label>
              <button onClick={createFolder} className="text-blue-600 dark:text-blue-400 font-bold hover:underline py-2 px-3">veya Boş Klasör Oluştur</button>
            </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
           {folders.map(folder => (
              <div 
                key={folder.id} 
                onClick={() => { setActiveFolderId(folder.id); setCurrentView('FOLDER_DETAIL'); }}
                className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500 transition-all cursor-pointer group relative flex flex-col"
              >
                  <div className="flex items-start justify-between mb-4">
                     <div className={`p-3 rounded-lg ${folder.exams.some(e => !e.isFinished) ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                        <FolderIcon className="w-8 h-8" />
                     </div>
                     <div className="flex gap-1">
                        <button onClick={(e) => startEditingFolder(e, folder)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={(e) => requestDeleteFolder(e, folder.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                     </div>
                  </div>
                  
                  {editingFolderId === folder.id ? (
                      <div onClick={e => e.stopPropagation()} className="mb-2">
                          <input 
                            autoFocus
                            value={editFolderTempName} 
                            onChange={e => setEditFolderTempName(e.target.value)}
                            onKeyDown={e => { if(e.key === 'Enter') saveFolderEdit(e); if(e.key === 'Escape') cancelFolderEdit(e); }}
                            onBlur={saveFolderEdit}
                            className="w-full border-b-2 border-blue-500 bg-transparent text-lg font-bold text-gray-900 dark:text-white focus:outline-none pb-1"
                          />
                      </div>
                  ) : (
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 truncate" title={folder.name}>{folder.name}</h3>
                  )}
                  
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-auto flex items-center gap-2">
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {folder.exams.length} Sınav</span>
                      {folder.exams.some(e => !e.isFinished) && <span className="flex items-center gap-1 text-orange-500 text-xs font-semibold bg-orange-50 dark:bg-orange-900/20 px-1.5 py-0.5 rounded ml-auto">Devam Ediyor</span>}
                  </div>
              </div>
           ))}
        </div>
      )}
    </div>
  );

  const renderFolderDetail = () => {
    const activeFolder = folders.find(f => f.id === activeFolderId);
    if (!activeFolder) return <div>Klasör bulunamadı</div>;

    return (
      <div className="p-6 max-w-5xl mx-auto w-full flex flex-col h-full">
        <div className="flex items-center gap-4 mb-8">
            <button onClick={() => { setActiveFolderId(null); setCurrentView('DASHBOARD'); }} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition flex-shrink-0">
                <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-200" />
            </button>
            <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                    <FolderIcon className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    {isEditingFolderName ? (
                        <div className="flex items-center gap-2 w-full max-w-md">
                            <input 
                                type="text" 
                                value={tempFolderName} 
                                onChange={(e) => setTempFolderName(e.target.value)} 
                                className="flex-1 border-b-2 border-blue-500 bg-transparent text-2xl font-bold text-gray-900 dark:text-white focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && saveFolderNameDetail()}
                                onBlur={saveFolderNameDetail}
                            />
                            <button onClick={saveFolderNameDetail} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"><CheckCircle className="w-5 h-5" /></button>
                        </div>
                    ) : (
                        <h1 onClick={() => { setTempFolderName(activeFolder.name); setIsEditingFolderName(true); }} className="text-2xl font-bold text-gray-900 dark:text-white truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition" title="İsmi değiştirmek için tıklayın">
                            {activeFolder.name}
                        </h1>
                    )}
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 ml-7">{activeFolder.exams.length} sınav mevcut</p>
            </div>
            
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl shadow-lg shadow-blue-500/30 flex items-center gap-2 transition transform active:scale-95 font-bold cursor-pointer">
              <Upload className="w-5 h-5" />
              <span className="hidden sm:inline">Sınav Yükle</span>
              <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileUpload} />
            </label>
        </div>

        <div className="flex-1 overflow-y-auto">
            {activeFolder.exams.length === 0 ? (
                <div className="text-center py-20 opacity-60 flex flex-col items-center">
                    <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                    <p className="text-xl text-gray-500 dark:text-gray-400">Bu klasör boş.</p>
                    <p className="text-sm text-gray-400 mt-2">Sağ üstteki butonu kullanarak yeni sınav yükleyin.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {activeFolder.exams.slice().reverse().map(exam => (
                        <div 
                            key={exam.id}
                            onClick={() => { setActiveExamId(exam.id); setCurrentView('EXAM_TAKER'); }}
                            className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer group flex items-center justify-between"
                        >
                            <div className="flex items-center gap-4 overflow-hidden">
                                <div className={`p-3 rounded-lg flex-shrink-0 ${exam.isFinished ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                    {exam.isFinished ? <CheckCircle className="w-6 h-6" /> : <Edit2 className="w-6 h-6" />}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-bold text-gray-900 dark:text-white truncate text-lg">{exam.title}</h3>
                                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                        <span>{new Date(exam.dateCreated).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                        <span>{exam.questions.length} Soru</span>
                                        {exam.isFinished && <span className="text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 px-1.5 rounded">Tamamlandı</span>}
                                    </div>
                                </div>
                            </div>
                            
                            <button 
                                onClick={(e) => requestDeleteExam(e, exam.id)} 
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Sınavı Sil"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    );
  };

  if (!currentUser) { return (<> <div className="absolute top-4 right-4 z-50"><button onClick={toggleDarkMode} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title={darkMode ? "Aydınlık Mod" : "Karanlık Mod"}>{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button></div><ServerConfigModal isOpen={isServerModalOpen} onClose={() => setIsServerModalOpen(false)} onSave={handleServerConfigSave} initialConfig={supabaseConfig} /><LoginScreen onLogin={handleLogin} onOpenServerSettings={() => setIsServerModalOpen(true)} isCloudConfigured={isValidSupabaseConfig(supabaseConfig) && isSupabaseInitialized()}/></>); }
  if (currentView === 'LOADING') { return <LoadingScreen message={loadingMessage || undefined} />; }
  
  const examToDeleteTitle = examToDeleteId ? folders.find(f => f.id === activeFolderId)?.exams.find(e => e.id === examToDeleteId)?.title : "";
  const folderToDeleteTitle = folderToDeleteId ? folders.find(f => f.id === folderToDeleteId)?.name : "";

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900 flex flex-col h-[100dvh] overflow-hidden relative">
      <ResetModal isOpen={isResetModalOpen} onClose={() => setIsResetModalOpen(false)} onSaveAndReset={handleArchiveAndReset} onJustReset={handleJustReset} />
      <FinishModal isOpen={isFinishModalOpen} onClose={() => setIsFinishModalOpen(false)} onConfirm={confirmFinishExam} />
      <DeleteModal isOpen={!!examToDeleteId} onClose={() => setExamToDeleteId(null)} onConfirm={confirmDeleteExam} itemName={examToDeleteTitle || "Sınav"} itemType="exam" />
      <DeleteModal isOpen={!!folderToDeleteId} onClose={() => setFolderToDeleteId(null)} onConfirm={confirmDeleteFolder} itemName={folderToDeleteTitle || "Klasör"} itemType="folder" />
      <UploadReportModal results={uploadResults} isOpen={isUploadReportOpen} onClose={() => setIsUploadReportOpen(false)} onCreateManually={handleManualCreate} />

      {currentView !== 'EXAM_TAKER' && currentView !== 'STATISTICS' && currentView !== 'SETTINGS' && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-3 px-6 shadow-sm flex items-center justify-between flex-shrink-0 transition-colors">
          <div className="flex items-center gap-2"><div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center text-white font-bold shadow-sm shadow-blue-500/30">A</div><span className="font-bold text-gray-800 dark:text-white text-lg tracking-tight">Sınav Asistanı</span></div>
          <div className="flex items-center gap-3">
             <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${isCloudSession ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{isCloudSession ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}{isCloudSession ? "Bulut" : "Yerel"}</div>
            <div className="flex items-center gap-2 mr-2"><div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-sm">{currentUser.substring(0, 2).toUpperCase()}</div><span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:block">{currentUser}</span></div>
            <button onClick={toggleDarkMode} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title={darkMode ? "Aydınlık Mod" : "Karanlık Mod"}>{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
            <button onClick={handleLogout} className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors" title="Çıkış Yap"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      )}

      <div ref={mainScrollRef} className="flex-1 overflow-y-auto">
        {currentView === 'DASHBOARD' && renderDashboard()}
        {currentView === 'FOLDER_DETAIL' && renderFolderDetail()}
        {currentView === 'STATISTICS' && <StatisticsView folders={folders} onBack={() => setCurrentView('DASHBOARD')} />}
        {currentView === 'SETTINGS' && (<SettingsView folders={folders} defaultFolderId={defaultFolderId} setDefaultFolderId={setDefaultFolderId} darkMode={darkMode} toggleDarkMode={toggleDarkMode} onBack={() => setCurrentView('DASHBOARD')} />)}
        {currentView === 'EXAM_TAKER' && (() => {
          const activeExam = folders.find(f => f.id === activeFolderId)?.exams.find(e => e.id === activeExamId);
          if (!activeExam) return <div>Sınav bulunamadı</div>;
          return (
            <div className="h-full relative flex flex-col">
               <div className="absolute top-3 right-4 z-40 flex gap-2"><button onClick={toggleDarkMode} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors shadow-sm border border-gray-200 dark:border-gray-600" title={darkMode ? "Aydınlık Mod" : "Karanlık Mod"}>{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button></div>
              <ExamTaker 
                exam={activeExam} 
                onUpdateExam={updateExamInState} 
                onBack={() => { handleInternalNavigation(); setCurrentView('FOLDER_DETAIL'); }} 
                onResetRequest={handleResetRequest}
                onFinishRequest={handleFinishRequest}
                isSaving={isSaving}
                lastSaved={lastSaved}
                hasUnsavedChanges={isDirtyRef.current}
                scrollToBottom={scrollToBottom}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default App;