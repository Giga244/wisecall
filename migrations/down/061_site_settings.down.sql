-- Undoes 061_site_settings.sql. (The home page's chosen question and answer is forgotten: the phone is hidden until one is chosen again.)
DROP TABLE IF EXISTS site_settings;
