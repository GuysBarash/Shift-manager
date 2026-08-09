export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
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

export type Availability = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
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
      availability: {
        Row: Availability;
        Insert: Partial<Availability> & {
          user_id: string;
          start_date: string;
          end_date: string;
        };
        Update: Partial<Availability>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
