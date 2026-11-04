import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { Folder } from '../types';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// ==============================================================================
// SABİT SUNUCU AYARLARI (İsteğe Bağlı)
// Uygulamanın her cihazda/tarayıcıda ayar sormadan direkt çalışması için
// aşağıdaki iki alanı Supabase panelindeki bilgilerinizle doldurun.
// ==============================================================================
const HARDCODED_URL = "";  // Örn: "https://xyz.supabase.co"
const HARDCODED_KEY = "";  // Örn: "eyJhbGciOiJIUzI1NiIsInR5..."
// ==============================================================================

export const getDefaultConfig = (): SupabaseConfig => ({
    url: HARDCODED_URL,
    anonKey: HARDCODED_KEY
});

export const normalizeSupabaseUrl = (url: string): string => {
  let trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
};

export const isValidSupabaseConfig = (config?: SupabaseConfig | null): boolean => {
  if (!config || !config.url || !config.anonKey) return false;
  const url = normalizeSupabaseUrl(config.url);
  const key = (config.anonKey || '').trim();
  if (!url || !key) return false;
  try {
    const parsed = new URL(url);
    const hasValidProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const hasValidHost = parsed.hostname.length > 3 && parsed.hostname.includes('.');
    const isNotPlaceholder = !parsed.hostname.startsWith('xyz.') && parsed.hostname !== 'xyz.supabase.co';
    const isNotPlaceholderKey = !key.includes('...');
    const hasValidKey = key.length > 20 && isNotPlaceholderKey;
    return hasValidProtocol && hasValidHost && isNotPlaceholder && hasValidKey;
  } catch {
    return false;
  }
};

let supabase: SupabaseClient | undefined;

// Initialize Supabase
export const initSupabase = (config: SupabaseConfig): SupabaseClient | undefined => {
  if (!isValidSupabaseConfig(config)) {
    supabase = undefined;
    return undefined;
  }

  const normalizedUrl = normalizeSupabaseUrl(config.url);
  const trimmedKey = config.anonKey.trim();

  try {
    supabase = createClient(normalizedUrl, trimmedKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return supabase;
  } catch (e) {
    console.warn("Supabase init error:", e);
    supabase = undefined;
    return undefined;
  }
};

export const resetSupabase = () => {
  supabase = undefined;
};

export const getSupabase = () => supabase;
export const isSupabaseInitialized = () => !!supabase;

// Helper to convert username to fake email (Supabase requires email)
// Using Turkish locale to handle I/ı/İ/i correctly
const getEmail = (username: string) => `${username.trim().toLocaleLowerCase('tr-TR')}@sinavasistani.app`;

export const cloudLogin = async (username: string, password: string): Promise<User> => {
  if (!supabase) throw new Error("Bulut servisi başlatılmadı. Lütfen ayarlardan bağlantıyı kurun.");
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: getEmail(username),
    password: password,
  });

  if (error) {
    console.error("Supabase Login Error:", error);
    if (error.message.includes("Invalid login") || error.message.includes("invalid_grant")) {
        throw new Error("Kullanıcı adı veya şifre hatalı. (Bulut hesabınız yoksa lütfen 'Kayıt Ol' seçeneğini kullanın.)");
    }
    if (error.message.includes("Email not confirmed")) {
        throw new Error("E-posta onayı gerekli. Lütfen Supabase panelinden e-posta onayını kapatınız.");
    }
    throw new Error(`Giriş hatası: ${error.message}`);
  }

  if (!data.user) throw new Error("Kullanıcı verisi alınamadı.");
  return data.user;
};

export const cloudRegister = async (username: string, password: string): Promise<User> => {
  if (!supabase) throw new Error("Bulut servisi başlatılmadı.");

  const { data, error } = await supabase.auth.signUp({
    email: getEmail(username),
    password: password,
  });

  if (error) {
    console.error("Supabase Register Error:", error);
    if (error.message.includes("already registered") || error.code === 'user_already_exists') {
        throw new Error("Bu kullanıcı adı zaten alınmış.");
    }
    throw new Error(`Kayıt hatası: ${error.message}`);
  }

  if (!data.user) throw new Error("Kayıt oluşturulamadı.");
  
  if (!data.session) {
      throw new Error("Kayıt başarılı ancak otomatik giriş yapılamadı. Lütfen Supabase panelinde 'Confirm Email' ayarının kapalı olduğundan emin olun.");
  }

  return data.user;
};

export const cloudLogout = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export const saveUserData = async (userId: string, folders: Folder[]) => {
  if (!supabase) return;

  const { error } = await supabase
    .from('profiles')
    .upsert({ 
        id: userId, 
        content: JSON.stringify(folders),
        updated_at: new Date().toISOString()
    });

  if (error) {
      console.error("Supabase save error:", error);
      throw new Error("Veri kaydedilemedi. 'profiles' tablosu eksik olabilir.");
  }
};

export const loadUserData = async (userId: string): Promise<Folder[] | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('content')
    .eq('id', userId)
    .single();

  if (error) {
      if (error.code !== 'PGRST116') {
          console.error("Supabase load error", error);
      }
      return [];
  }

  if (data && data.content) {
    try {
      return JSON.parse(data.content);
    } catch (e) {
      console.error("Cloud data parse error", e);
      return [];
    }
  }
  return [];
};