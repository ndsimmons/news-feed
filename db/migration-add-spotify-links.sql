-- Add spotify_url column to sources table for podcasts
ALTER TABLE sources ADD COLUMN spotify_url TEXT;

-- Update podcast sources with their Spotify show URLs
-- Note: These are the Spotify show pages, not episode-specific links
UPDATE sources SET spotify_url = 'https://open.spotify.com/show/2SjFCQGy4SHswwEeYtE8ET' WHERE name = 'The Bill Simmons Podcast';
UPDATE sources SET spotify_url = 'https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL' WHERE name = 'Lex Fridman Podcast';
UPDATE sources SET spotify_url = 'https://open.spotify.com/show/5Ii8PyMV6ucB8IIRW9I8Wt' WHERE name = 'The Dwarkesh Podcast';
UPDATE sources SET spotify_url = 'https://open.spotify.com/show/3e6gMV4GWm6RmJGxkXqcqr' WHERE name = 'American Compass Podcast';
