-- Migration 024: fijar search_path en las funciones auth/PIN restantes
--
-- El linter (0011 function_search_path_mutable) marca 6 funciones que corren
-- con el search_path del rol que llama, no uno fijo. Un search_path mutable en
-- una funcion SECURITY DEFINER es un vector de escalacion (alguien crea un
-- objeto en un esquema que resuelve antes que el esperado).
--
-- Las 3 funciones de PIN llaman crypt()/gen_salt() de pgcrypto, que vive en el
-- esquema `extensions`, asi que necesitan `public, extensions`. Verificado que
-- el roundtrip de crypt sigue funcionando bajo ese search_path.
-- Las otras 3 solo tocan public.* -> `public` alcanza.

alter function public.verify_quick_pin(uuid, text)      set search_path = public, extensions;
alter function public.set_quick_pin(text)               set search_path = public, extensions;
alter function public.admin_set_user_pin(uuid, text)    set search_path = public, extensions;
alter function public.get_user_role(uuid)               set search_path = public;
alter function public.get_user_location(uuid)           set search_path = public;
alter function public.block_guaira_zombie_timestamp()   set search_path = public;
