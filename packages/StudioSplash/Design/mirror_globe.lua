-- Enforce mirror symmetry on the layered globe (frames are 1-based here):
--   * static layers: copy the left half onto the right (column 21 is the centre)
--   * meridians: frames 1 and 5 symmetric the same way; frames 6, 7, 8 = flipped frames 4, 3, 2
local spr = app.open(app.params["src"])
local W, MID = 41, 20
local function full(cel)
  local img = Image(W, W, ColorMode.RGB)
  if cel then img:drawImage(cel.image, cel.position) end
  return img
end
local function mirrorLeft(img)
  local out = img:clone()
  for y = 0, W - 1 do for x = MID + 1, W - 1 do out:drawPixel(x, y, img:getPixel(W - 1 - x, y)) end end
  return out
end
local function flip(img)
  local out = Image(W, W, ColorMode.RGB)
  for y = 0, W - 1 do for x = 0, W - 1 do out:drawPixel(x, y, img:getPixel(W - 1 - x, y)) end end
  return out
end
local mer
for _, layer in ipairs(spr.layers) do
  if layer.name:find("same every frame") then
    local cel = layer:cel(1)
    cel.image = mirrorLeft(full(cel)); cel.position = Point(0, 0)
  else
    mer = layer
  end
end
local src = {}
for f = 1, 8 do src[f] = full(mer:cel(f)) end
local function set(f, img) spr:newCel(mer, f, img, Point(0, 0)) end
set(1, mirrorLeft(src[1])); set(5, mirrorLeft(src[5]))
set(6, flip(src[4])); set(7, flip(src[3])); set(8, flip(src[2]))
for _, layer in ipairs(spr.layers) do
  if layer ~= mer then
    print(layer.name, "still linked:", layer:cel(1).image == layer:cel(8).image)
  end
end
spr:saveAs(app.params["out"])
