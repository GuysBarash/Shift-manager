export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  color: string | null;
  sambatz: boolean;
  is_admin: boolean;
  created_at: string;
};

export type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_by: string | null;
  updated_at: string;
};

export type ShiftAudit = {
  id: string;
  shift_id: string;
  changed_by: string | null;
  change_type: "update" | "delete";
  old_value: Shift;
  changed_at: string;
  undone: boolean;
};

export type TimeOff = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      shifts: {
        Row: Shift;
        Insert: Partial<Shift> & {
          shift_date: string;
          start_time: string;
          end_time: string;
        };
        Update: Partial<Shift>;
        Relationships: [];
      };
      shift_audit: {
        Row: ShiftAudit;
        Insert: Partial<ShiftAudit>;
        Update: Partial<ShiftAudit>;
        Relationships: [];
      };
      time_off: {
        Row: TimeOff;
        Insert: Partial<TimeOff> & {
          user_id: string;
          start_date: string;
          end_date: string;
        };
        Update: Partial<TimeOff>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
