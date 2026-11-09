#!/usr/bin/env python3
"""Build-only BLOFY STREAM brand artwork for both TV and Android.
Creates source-controlled-reproducible PNG launcher artwork. Nothing is
changed in BLOFY PLAYER's own resources. Requires Pillow >= 10.
"""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "src/main/assets/fonts/IBMPlexSansArabic-SemiBold.ttf"
FONT_LIGHT = ROOT / "src/main/assets/fonts/IBMPlexSansArabic-Regular.ttf"
K = 3
PURPLE = (156, 80, 243)
VIOLET = (106, 48, 212)
LAVENDER = (210, 177, 255)
WHITE = (250, 248, 255)

def font(sz, light=False):
    target=FONT_LIGHT if light else FONT
    return ImageFont.truetype(str(target), round(sz*K))

def size_box(draw, text, f):
    b=draw.textbbox((0,0),text,font=f,stroke_width=0)
    return b[2]-b[0],b[3]-b[1]

def gradient_bg(w,h,radius=0):
    img=Image.new("RGBA",(w*K,h*K))
    px=img.load()
    for y in range(h*K):
        for x in range(w*K):
            t=(x/(w*K)+y/(h*K))*.5
            v=max(0,min(1,t))
            px[x,y]=(round(21+9*v),round(12+3*v),round(36+19*v),255)
    return img

def aura(canvas,x,y,radius):
    # A restrained glow similar to BLOFY PLAYER's premium violet UI.
    glow=Image.new("RGBA",canvas.size,(0,0,0,0))
    d=ImageDraw.Draw(glow)
    rr=int(radius*K)
    d.ellipse((int(x*K)-rr,int(y*K)-rr,int(x*K)+rr,int(y*K)+rr),
              fill=(132,48,255,115))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40*K)))

def triangle_mark(canvas, cx, cy, r):
    # Diagonal purple glass play mark; no old PLAYER wordmark.
    cx,cy,r=cx*K,cy*K,r*K
    shadow=Image.new("RGBA",canvas.size,(0,0,0,0))
    ds=ImageDraw.Draw(shadow)
    back=[(cx-r*.36,cy-r*.48),(cx+r*.49,cy),(cx-r*.36,cy+r*.48)]
    ds.line(back+[back[0]],fill=(116,35,232,135),width=round(r*.24),
            joint="curve")
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(r*.11))))
    d=ImageDraw.Draw(canvas)
    outer=[(cx-r*.35,cy-r*.48),(cx+r*.50,cy),(cx-r*.35,cy+r*.48)]
    d.line(outer+[outer[0]],fill=(84,35,191,255),width=round(r*.19),
           joint="curve")
    d.line(outer+[outer[0]],fill=(186,95,255,255),width=round(r*.12),
           joint="curve")
    # Specular highlight conveys the depth of the original logo.
    d.line([outer[0],outer[1]],fill=(229,181,255,255),width=round(r*.045),
           joint="curve")
    d.polygon([(cx-r*.15,cy-r*.25),(cx+r*.27,cy),
               (cx-r*.15,cy+r*.25)],fill=WHITE)
    d.line([(cx-r*.23,cy-r*.32),(cx-r*.23,cy+r*.32)],
           fill=(232,211,255,180),width=max(1,round(r*.025)))

def text_center(canvas, text, cy, size, color, tracking=0, light=False):
    d=ImageDraw.Draw(canvas)
    ft=font(size,light)
    width,height=size_box(d,text,ft)
    # Vertically position relative to glyph bounds, not font ascenders.
    bounds=d.textbbox((0,0),text,font=ft)
    y=int(cy*K-height/2-bounds[1])
    x=int((canvas.width-width)/2)
    d.text((x,y),text,font=ft,fill=color)
    
def icon():
    canvas=gradient_bg(512,512)
    aura(canvas,254,218,126)
    d=ImageDraw.Draw(canvas)
    pad=18*K
    d.rounded_rectangle((pad,pad,512*K-pad,512*K-pad),
                        radius=104*K,outline=(111,59,170,255),width=3*K)
    triangle_mark(canvas,252,205,230)
    text_center(canvas,"BLOFY",369,63,WHITE)
    text_center(canvas,"STREAM",422,30,LAVENDER,light=True)
    return canvas.resize((512,512),Image.Resampling.LANCZOS)

def banner():
    canvas=gradient_bg(320,180)
    aura(canvas,72,95,62)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((5*K,5*K,315*K,175*K),
                        radius=19*K,outline=(111,62,163,255),width=2*K)
    triangle_mark(canvas,70,91,124)
    f1=font(30)
    f2=font(23,light=True)
    d.text((145*K,65*K),"BLOFY",font=f1,fill=WHITE)
    d.text((145*K,108*K),"STREAM",font=f2,fill=LAVENDER)
    d.line((144*K,140*K,292*K,140*K),fill=(144,78,230,160),width=2*K)
    return canvas.resize((320,180),Image.Resampling.LANCZOS)

def login_mark():
    canvas=Image.new("RGBA",(420*K,245*K),(0,0,0,0))
    aura(canvas,210,120,72)
    triangle_mark(canvas,210,119,186)
    return canvas.resize((420,245),Image.Resampling.LANCZOS)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",required=True)
    args=ap.parse_args()
    root=Path(args.out)
    images=[
        (root/"drawable-nodpi/blofy_stream_app_icon.png",icon()),
        (root/"drawable-xhdpi/blofy_stream_tv_banner.png",banner()),
        (root/"drawable-nodpi/blofy_stream_brand.png",login_mark()),
    ]
    for path,image in images:
        path.parent.mkdir(parents=True,exist_ok=True)
        image.save(path,optimize=True)
        print(str(path),image.size)

if __name__ == "__main__":
    main()
