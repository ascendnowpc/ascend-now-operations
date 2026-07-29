import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useTeacherNames(ids: string[]) {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (ids.length === 0) { setNames(new Map()); return; }
    supabase
      .from("teachers")
      .select("id, first_name, last_name")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        const map = new Map<string, string>();
        for (const t of data as { id: string; first_name: string; last_name: string | null }[]) {
          map.set(t.id, `${t.first_name} ${t.last_name ?? ""}`.trim());
        }
        setNames(map);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return names;
}
