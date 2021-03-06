import { h, render,Component, } from 'preact';
import {computePosition, convertColor, isMobile} from "../utils";
import Highlight from '../assets/highlight.svg';
import './action-bar.scss';

export default function ActionBars ({pagenote}) {
  const recordButtonX = (isMobile ? 0 : pagenote.target.x)+'px';
  const recordButtonY = (isMobile? pagenote.target.y + 50 : pagenote.target.y) + "px";
  const functionColors = pagenote.options.functionColors;
  const colors = pagenote.options.colors;
  const showButton = (pagenote.status === pagenote.CONSTANT.WAITING ||
                    pagenote.status === pagenote.CONSTANT.PLAYANDWAIT);
  const shortCuts = pagenote.options.shortCuts;
  const maskPosition = isMobile ? {
    x: colors.length * - 40,
    y: 0,
  } : computePosition(colors.length-1);

  const canHighlight = pagenote.target.canHighlight;

  function recordNew(e) {
    const color = e.currentTarget.dataset.color || colors[0];
    pagenote.record({
      bg:color,
    });
  }

  return (
    <div style={{
      position: "absolute",
      zIndex: 2147483648,
      left: recordButtonX,
      top: recordButtonY,
      transition: ".5s",
      userSelect: "none",
      textAlign: 'left'
    }}>
      {
        showButton
        &&
        <div>
          {
            canHighlight &&
            <pagenote-colors-container>
              {
                colors.map((color, index) => {
                  const {x:offsetX,y:offsetY} = (isMobile || index===0) ? {
                    x: (index) * - 40,
                    y: 0,
                  } : computePosition(index-1);

                  return(
                    <pagenote-color-button
                         data-color={color}
                         data-pagenotecolor={color}
                         style={{
                           '--color': color,
                           transform: `translate(${offsetX}px,${offsetY}px)`,
                           top: (offsetY / -1) + 'px',
                           left: (offsetX / -1) + 'px',
                           color: convertColor(color).textColor,
                           textShadow: `1px 1px 0px ${convertColor(convertColor(color).textColor).textColor}`,
                           animationDelay: index*0.1+'s',
                           transitionDelay: index*0.1+'s',
                         }}
                         onClick={recordNew}
                    >{index!==0?shortCuts[index]: <span data-tip={`【快捷键】按下色盘对应字母试试。主色快捷键：${shortCuts[0]}`}><Highlight  data-pagenotecolor={color} style={{userSelect:'none'}} fill={color}/></span> }
                    </pagenote-color-button>
                  )
                })
              }
            </pagenote-colors-container>
          }
          {
            functionColors.map((actionGroup,index)=> {
              // actionGroup filter when
              return (
                <pagenote-plugin-group
                  style={{
                  left: ((index+1)*34+4) + 'px',
                  animationDelay: (index+1) * 0.2 + 's',
                }}>
                  {
                    actionGroup.map((action)=>{
                      const image = /^<svg/.test(action.icon) ?  `data:image/svg+xml;base64,${window.btoa(action.icon)}` : action.icon;
                      return (
                        <pagenote-action-button
                          key={action.name}
                          data-tip={`${action.name}${action.shortcut?' 快捷键：'+action.shortcut:''}`}
                          data-eventid={action.eventid}
                          style={{
                            backgroundImage: `url(${image})`,
                          }}
                        >
                      </pagenote-action-button>
                      )
                    })
                  }
                </pagenote-plugin-group>
              )
            })
          }
        </div>
      }
    </div>
  )
}
