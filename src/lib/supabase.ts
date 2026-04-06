import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qzhssjxtjqogvefdxkri.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JbrXeY6cRtiZHyYaq_MFRA_6GSsqz5t';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
